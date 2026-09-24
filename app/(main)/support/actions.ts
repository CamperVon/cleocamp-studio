'use server'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { currentPersonId } from '@/lib/session'
import { Prisma } from '@/generated/prisma/client'
import { sendEmail } from '@/lib/email'
import { draftForCase } from '@/lib/support/draft'
import { freshOrder, removeUnshippedUnits, setShippingAddress } from '@/lib/support/orders'
import { addressChangeProblems, unfilled, type DraftAddress } from '@/lib/support/reply'

const STATUSES = ['OPEN', 'WAITING_ON_CUSTOMER', 'WAITING_ON_RETURN', 'RESOLVED'] as const
type Status = (typeof STATUSES)[number]

/** Moving a case along. Only a signed-in person does this — never an email. */
export async function setCaseStatus(id: string, status: Status) {
  if (!STATUSES.includes(status)) return
  await db.supportCase.update({
    where: { id },
    data: { status, resolvedAt: status === 'RESOLVED' ? new Date() : null },
  })
  revalidatePath('/support')
  revalidatePath('/')
}

/** A note on the case for the team — what was done off-app, a phone call. Never sent. */
export async function addCaseNote(id: string, text: string) {
  if (!text.trim()) return
  const who = await currentPersonId()
  const person = who ? await db.person.findUnique({ where: { id: who }, select: { name: true } }) : null
  await db.supportMessage.create({
    data: { caseId: id, direction: 'NOTE', fromAddress: person?.name ?? null, body: text.trim() },
  })
  revalidatePath('/support')
}

// ── Phase 2: replies ─────────────────────────────────────────────────────
//
// The ONLY way anything reaches a customer. Each action re-checks who is
// asking — a signed-in person on the team — and re-checks the draft itself
// on the server, rather than trusting that the button was disabled. Never
// triggered by an email: anyone can fake one (CLAUDE.md §4).

const SUPPORT_FROM = process.env.SUPPORT_FROM || 'Cleo Studio <support@send.cleocamp.com>'
const SUPPORT_REPLY_TO = 'support@cleocamp.com'

type Result = { ok: true } | { ok: false; error: string }

async function approver() {
  const id = await currentPersonId()
  if (!id) return null
  return db.person.findFirst({ where: { id, active: true, external: false }, select: { id: true, name: true } })
}

/** Send the (possibly edited) reply on a case. */
export async function sendReply(id: string, text: string): Promise<Result> {
  const who = await approver()
  if (!who) return { ok: false, error: 'Sign in again — only the team can send.' }
  const body = text.trim()
  if (!body) return { ok: false, error: 'The reply is empty.' }
  const gaps = unfilled(body)
  if (gaps.length) return { ok: false, error: `Fill in ${gaps.map((g) => `[${g}]`).join(', ')} first.` }

  const c = await db.supportCase.findUnique({
    where: { id },
    include: { messages: { where: { direction: 'INBOUND' }, orderBy: { createdAt: 'desc' }, take: 1 } },
  })
  if (!c) return { ok: false, error: 'Case not found.' }

  // Thread onto the customer's own last message when we know its id.
  const last = c.messages[0]?.inboundEmailId
    ? await db.inboundEmail.findUnique({ where: { id: c.messages[0].inboundEmailId }, select: { messageId: true } })
    : null
  const mid = last?.messageId && !last.messageId.startsWith('derived:')
    ? (last.messageId.startsWith('<') ? last.messageId : `<${last.messageId}>`)
    : null
  const subject = c.subject ? (/^\s*re:/i.test(c.subject) ? c.subject : `Re: ${c.subject}`) : 'Your Cleo Camp order'

  const res = await sendEmail({
    from: SUPPORT_FROM, to: [c.customerEmail], replyTo: SUPPORT_REPLY_TO, subject, text: body,
    ...(mid ? { headers: { 'In-Reply-To': mid, References: mid } } : {}),
  })
  if (!res.sent) return { ok: false, error: `Not sent: ${'reason' in res ? res.reason : 'unknown error'}` }

  await db.$transaction([
    db.supportMessage.create({ data: { caseId: id, direction: 'OUTBOUND', fromAddress: who.name, body } }),
    db.supportCase.update({
      where: { id },
      data: {
        draftReply: null, draftNeeds: null, draftAddress: Prisma.DbNull, draftedAt: null,
        // A return or exchange now waits on the parcel; anything else is
        // answered. A new email from the customer reopens it either way.
        status: c.category === 'RETURN_EXCHANGE' ? 'WAITING_ON_RETURN' : 'RESOLVED',
        resolvedAt: c.category === 'RETURN_EXCHANGE' ? null : new Date(),
      },
    }),
  ])
  revalidatePath('/support')
  revalidatePath('/')
  return { ok: true }
}

/**
 * Change the order's ship-to in Shopify, then send the reply. The checks run
 * again against the order as it is right now — it may have been packed since
 * the draft was written. If Shopify refuses, nothing is sent.
 */
export async function applyAddressAndReply(id: string, text: string): Promise<Result> {
  const who = await approver()
  if (!who) return { ok: false, error: 'Sign in again — only the team can do this.' }
  const c = await db.supportCase.findUnique({ where: { id } })
  const to = (c?.draftAddress as { to?: DraftAddress } | null)?.to ?? null
  if (!c?.shopifyOrderId || !to) return { ok: false, error: 'No order or new address on this case.' }
  if (unfilled(text).length) return { ok: false, error: 'Fill in the bracketed gaps in the reply first.' }

  let fresh
  try {
    fresh = await freshOrder(c.shopifyOrderId)
  } catch (e) {
    return { ok: false, error: `Could not read the order from Shopify: ${e instanceof Error ? e.message.slice(0, 160) : String(e)}` }
  }
  const problems = addressChangeProblems(fresh, c.customerEmail, to)
  if (problems.length) return { ok: false, error: problems.join(' ') }

  let changed
  try {
    changed = await setShippingAddress(c.shopifyOrderId, to)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return {
      ok: false,
      error: /access|scope|denied|permission/i.test(msg)
        ? 'Shopify would not let the app edit orders — it needs the "write orders" permission. Nothing was changed or sent.'
        : `Shopify refused the change: ${msg.slice(0, 160)}. Nothing was sent.`,
    }
  }
  if (!changed.ok) return { ok: false, error: `Shopify refused the change: ${changed.error}. Nothing was sent.` }

  const line = (a: DraftAddress | null | undefined) =>
    a ? [a.name, a.address1, a.address2, [a.city, a.provinceCode, a.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ') : 'unknown'
  await db.supportMessage.create({
    data: {
      caseId: id, direction: 'NOTE', fromAddress: who.name,
      body: `Ship-to on ${c.shopifyOrderName} changed in Shopify.\nWas: ${line(fresh?.shipTo)}\nNow: ${line(to)}`,
    },
  })
  return sendReply(id, text)
}

/** Ask for a fresh draft — after the case changed, or when the first one failed. */
export async function redraftReply(id: string): Promise<void> {
  if (!(await approver())) return
  await draftForCase(id)
  revalidatePath('/support')
}

/**
 * Take an item that has not shipped off the customer's order, at their
 * request. Same guard as an address change: the case must be from the email
 * the order was placed with, checked on a fresh read. The refund is NOT sent
 * here — the case note says what is owed and a person refunds it in Shopify.
 */
export async function removeUnshippedItem(id: string, lineItemId: string): Promise<Result & { note?: string }> {
  const who = await approver()
  if (!who) return { ok: false, error: 'Sign in again — only the team can do this.' }
  const c = await db.supportCase.findUnique({ where: { id } })
  if (!c?.shopifyOrderId) return { ok: false, error: 'No order on this case.' }

  let fresh
  try {
    fresh = await freshOrder(c.shopifyOrderId)
  } catch (e) {
    return { ok: false, error: `Could not read the order from Shopify: ${e instanceof Error ? e.message.slice(0, 160) : String(e)}` }
  }
  if (!fresh) return { ok: false, error: 'Shopify has no such order.' }
  if (!fresh.email || fresh.email.toLowerCase() !== c.customerEmail.toLowerCase()) {
    return { ok: false, error: `This case is not from the email on the order${fresh.email ? ` (${fresh.email})` : ''}. If you are sure, do it in Shopify: Edit order.` }
  }
  const item = fresh.items.find((i) => i.id === lineItemId)
  if (!item || !item.unfulfilled) return { ok: false, error: 'That item has shipped, or is no longer on the order.' }

  const label = `${item.unfulfilled} × ${item.title}${item.variant ? ` — ${item.variant}` : ''}`
  let r
  try {
    r = await removeUnshippedUnits(c.shopifyOrderId, lineItemId, item.variantId ?? null, `Removed ${label} (not shipped) at the customer's request — ${who.name}, via Studio support.`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: /access|scope|denied|permission/i.test(msg) ? 'Shopify would not let the app edit orders yet (write_order_edits). Nothing was changed.' : `Shopify refused: ${msg.slice(0, 160)}` }
  }
  if (!r.ok) return { ok: false, error: r.error }

  const note = `Removed ${label} from ${c.shopifyOrderName} — it had not shipped, and is back in stock.` +
    (r.refundOwed ? ` Refund owed: ${r.refundOwed}. Send it in Shopify (the order's Refund button); no restocking fee, it never shipped.` : ' No refund shows as owed — check the order in Shopify.')
  const after = await freshOrder(c.shopifyOrderId).catch(() => null)
  await db.$transaction([
    db.supportMessage.create({ data: { caseId: id, direction: 'NOTE', fromAddress: who.name, body: note } }),
    ...(after ? [db.supportCase.update({ where: { id }, data: { orderSnapshot: after as unknown as Prisma.InputJsonValue } })] : []),
  ])
  revalidatePath('/support')
  return { ok: true, note }
}
