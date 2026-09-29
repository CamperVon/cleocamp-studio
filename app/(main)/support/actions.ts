'use server'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { currentPersonId } from '@/lib/session'
import { Prisma } from '@/generated/prisma/client'
import { sendEmail } from '@/lib/email'
import { grantedScopes } from '@/lib/integrations/shopify'
import { draftForCase, refreshOrder } from '@/lib/support/draft'
import { cancelAndRefund, cancelUnshippedLines, freshOrder, removeUnshippedUnits, setShippingAddress } from '@/lib/support/orders'
import { addressChangeProblems, claimsNotYetDone, partlyShipped, refundIssued, SUPPORT_FROM, SUPPORT_REPLY_TO, unfilled, unshippedLines, type DraftAddress } from '@/lib/support/reply'
import { namesMatch } from '@/lib/support/core'
import type { OrderSnapshot } from '@/lib/support/orders'

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

/**
 * A note on the case for the team — what was done off-app, a phone call, an
 * instruction. Never sent to the customer. It is emailed to Jane, who runs
 * support (Brandon, 25 Sept 2026: "CS notes to the team should be sent back
 * to jane's email"), unless she wrote it. Replies go to whoever wrote it.
 */
/** Who a note can be sent to for review. Brandon, 29 Sept 2026: "flag for cleo or jane". */
const REVIEWERS = { jane: 'per_jane', cleo: 'per_cleo', brandon: 'per_brandon' } as const
export type Reviewer = keyof typeof REVIEWERS

/**
 * A note on a case, and — only when ticked — the case sent to Jane and/or
 * Cleo for review. Brandon, 29 Sept 2026: "make it a checkbox and then have
 * the flag email jane or cleo, forwarding the email for their review with a
 * note from mouse." Until then every note went to Jane automatically.
 *
 * The email carries the note, Mouse's summary and the order's state, and the
 * customer's own latest email below. It goes to team inboxes only; nothing
 * reaches the customer. Replies go to whoever wrote the note.
 */
export async function addCaseNote(id: string, text: string, sendTo: Reviewer[] = []) {
  const to = [...new Set(sendTo.filter((r) => r in REVIEWERS))]
  if (!text.trim() && !to.length) return
  const who = await currentPersonId()
  const person = who ? await db.person.findUnique({ where: { id: who }, select: { name: true, email: true } }) : null
  const body = text.trim() || 'Please take a look.'
  const note = await db.supportMessage.create({
    data: { caseId: id, direction: 'NOTE', fromAddress: person?.name ?? null, body },
  })
  if (to.length) {
    // Her own words only, not the quoted thread below them.
    const { trimQuoted } = await import('@/lib/support/core')
    const [people, c, last] = await Promise.all([
      db.person.findMany({ where: { id: { in: to.map((r) => REVIEWERS[r]) }, active: true }, select: { name: true, email: true } }),
      db.supportCase.findUnique({ where: { id }, select: { customerName: true, customerEmail: true, subject: true, shopifyOrderName: true, summary: true, orderSnapshot: true, draftReply: true, status: true } }),
      db.supportMessage.findFirst({ where: { caseId: id, direction: 'INBOUND' }, orderBy: { createdAt: 'desc' }, select: { body: true, fromAddress: true, createdAt: true } }),
    ])
    // Nobody is emailed their own note.
    const recipients = people.filter((p) => p.email && p.email.toLowerCase() !== person?.email?.toLowerCase())
    if (c && recipients.length) {
      const customer = c.customerName ?? c.customerEmail
      const o = c.orderSnapshot as { name?: string; createdAt?: string; financialStatus?: string | null; fulfillmentStatus?: string | null; total?: string | null } | null
      const la = (d: string | Date) => new Date(d).toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric' })
      const orderLine = o?.name
        ? `Order ${o.name}${o.createdAt ? `, placed ${la(o.createdAt)}` : ''}: ${[o.financialStatus, o.fulfillmentStatus].filter(Boolean).join(', ').toLowerCase() || 'status unknown'}${o.total ? `, ${/^[\d.]+ USD$/.test(o.total) ? `$${Number(o.total.split(' ')[0]).toFixed(2)}` : o.total}` : ''}.`
        : 'No Shopify order is matched to this case.'
      const draftLine = c.draftReply && c.status !== 'RESOLVED' ? 'Mouse has a reply drafted on the case, waiting for someone to check it and send.' : 'No reply is drafted yet.'
      const sent = await sendEmail({
        to: recipients.map((p) => p.email!),
        ...(person?.email ? { replyTo: person.email } : {}),
        subject: `For your review: ${customer}${c.shopifyOrderName ? ` · ${c.shopifyOrderName}` : ''}${c.subject ? ` · ${c.subject}` : ''}`,
        text:
          `${person?.name ?? 'Someone on the team'} flagged this support case for you:\n\n${body}\n\n` +
          `From Mouse: ${c.summary ?? 'no summary yet.'}\n${orderLine}\n${draftLine}\n\n` +
          `Open the case: https://admin.cleocamp.com/support#${id}\n\n` +
          (last
            ? `---------- The customer's email ----------\nFrom: ${customer} <${c.customerEmail}>\nDate: ${la(last.createdAt)}\n${c.subject ? `Subject: ${c.subject}\n` : ''}\n${trimQuoted(last.body).text.slice(0, 6000)}\n\n`
            : '') +
          `Nothing has been sent to the customer.\n— Studio Mouse`,
      }).catch((e) => ({ sent: false as const, reason: String(e) }))
      // Marked only once it went, so the page never shows a note as sent that was not.
      if (sent.sent) await db.supportMessage.update({ where: { id: note.id }, data: { emailedTo: recipients.map((p) => p.name.split(' ')[0]).join(', ') } })
      else console.error('[support] review email failed', sent)
    }
  }
  revalidatePath('/support')
}

// ── Phase 2: replies ─────────────────────────────────────────────────────
//
// The ONLY way anything reaches a customer. Each action re-checks who is
// asking — a signed-in person on the team — and re-checks the draft itself
// on the server, rather than trusting that the button was disabled. Never
// triggered by an email: anyone can fake one (CLAUDE.md §4).


type Result = { ok: true } | { ok: false; error: string }

/**
 * A permission refusal, said precisely: what Shopify said, and which
 * permissions the store has actually granted the app, so a missing grant
 * is visible instead of guessed at.
 */
async function permissionError(action: string, needs: string, shopifySaid: string): Promise<string> {
  const scopes = await grantedScopes()
  const has = scopes ? scopes.split(',').map((x) => x.trim()) : null
  return (
    `Shopify would not let the app ${action}. Shopify said: "${shopifySaid.slice(0, 160)}". ` +
    (has
      ? has.includes(needs)
        ? `The app does hold ${needs}, so this is something else; check the order in Shopify. `
        : `The app's access right now: ${has.join(', ') || 'none'}. It needs ${needs}: accept the app's updated permissions in Shopify. `
      : '') +
    'Nothing was changed or sent.'
  )
}

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
  // A case filed under our own address has no customer to reply to.
  if (/@(send\.)?cleocamp\.com$/i.test(c.customerEmail)) {
    return { ok: false, error: "This case is filed under our own address, so there is no customer to send to. Reply from your own email." }
  }

  // A reply that tells the customer their order is cancelled or refunded must
  // be true when it lands. Sending does not cancel or refund anything, so the
  // order is read fresh from Shopify now and the send is refused if it does
  // not show what the reply claims. See claimsNotYetDone.
  if (claimsNotYetDone(body, { name: 'the order', financialStatus: 'UNKNOWN', cancelledAt: null }).length) {
    const snap = (c.orderSnapshot as OrderSnapshot | null) ?? null
    const now = snap?.id ? await freshOrder(snap.id).catch(() => null) : null
    if (!now) {
      return { ok: false, error: 'This reply says the order is cancelled or refunded, and Shopify could not be checked. Confirm it in Shopify, then send.' }
    }
    const problems = claimsNotYetDone(body, now)
    if (problems.length) {
      return { ok: false, error: `${problems.join(' ')} Cancel and refund it in Shopify first, then tap Send again. Nothing was sent.` }
    }
  }

  // Thread onto the customer's own last message when we know its id.
  const last = c.messages[0]?.inboundEmailId
    ? await db.inboundEmail.findUnique({ where: { id: c.messages[0].inboundEmailId }, select: { messageId: true, fromAddress: true } })
    : null
  // A forward from the team carries the teammate's message id, which the
  // customer never saw — threading onto it would only confuse their inbox.
  const fromCustomer = !!last && last.fromAddress.toLowerCase().includes(c.customerEmail.toLowerCase())
  const mid = fromCustomer && last?.messageId && !last.messageId.startsWith('derived:')
    ? (last.messageId.startsWith('<') ? last.messageId : `<${last.messageId}>`)
    : null
  const subject = c.subject ? (/^\s*re:/i.test(c.subject) ? c.subject : `Re: ${c.subject}`) : 'Your Cleo Camp order'

  const res = await sendEmail({
    from: SUPPORT_FROM, to: [c.customerEmail], replyTo: SUPPORT_REPLY_TO, subject, text: body,
    ...(mid ? { headers: { 'In-Reply-To': mid, References: mid } } : {}),
  })
  if (!res.sent) return { ok: false, error: `Not sent: ${'reason' in res ? res.reason : 'unknown error'}` }

  await db.$transaction([
    db.supportMessage.create({ data: { caseId: id, direction: 'OUTBOUND', fromAddress: who.name, body, draftedText: c.draftReply } }),
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
        ? await permissionError('edit this order', 'write_orders', msg)
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

/**
 * Cancel the order in Shopify with a full refund and restock, then send the
 * reply. The tap is the approval (money always needs one, CLAUDE.md §4).
 * Same guard as an address change, on a fresh read: the case must come from
 * the email the order was placed with, and nothing on it may have shipped.
 * If Shopify refuses, or has not finished, nothing is sent.
 */
export async function cancelOrderAndReply(id: string, text: string): Promise<Result> {
  const who = await approver()
  if (!who) return { ok: false, error: 'Sign in again — only the team can do this.' }
  const c = await db.supportCase.findUnique({ where: { id } })
  if (!c?.shopifyOrderId) return { ok: false, error: 'No order on this case.' }
  if (unfilled(text).length) return { ok: false, error: 'Fill in the bracketed gaps in the reply first.' }

  let fresh
  try {
    fresh = await freshOrder(c.shopifyOrderId)
  } catch (e) {
    return { ok: false, error: `Could not read the order from Shopify: ${e instanceof Error ? e.message.slice(0, 160) : String(e)}` }
  }
  if (!fresh) return { ok: false, error: 'Shopify has no such order.' }
  // Theirs by email, or by name when they wrote from another address. The
  // refund can only go back to the card that paid, so a name match is enough
  // here; an address change still needs the order's own email.
  const sameEmail = !!fresh.email && fresh.email.toLowerCase() === c.customerEmail.toLowerCase()
  if (!sameEmail && !namesMatch(c.customerName, c.customerEmail, [fresh.shipTo?.name, fresh.billName])) {
    return { ok: false, error: `The name on this order does not match the person writing in${fresh.email ? ` (it was placed with ${fresh.email})` : ''}. If you are sure it is theirs, cancel it in Shopify.` }
  }
  const keep = (o: OrderSnapshot) => db.supportCase.update({
    where: { id },
    data: { orderSnapshot: { ...o, emailMismatch: sameEmail ? null : o.email, sameName: !sameEmail || undefined } as unknown as Prisma.InputJsonValue },
  })
  const money = (o: OrderSnapshot) => `${o.refunded?.toFixed(2) ?? '?'} ${o.total?.split(' ')[1] ?? ''}`.trim()
  const fail = (msg: string) => /access|scope|denied|permission/i.test(msg)
    ? permissionError('cancel this order', 'write_orders', msg)
    : Promise.resolve(`Shopify refused: ${msg.slice(0, 160)}. Nothing was sent.`)

  const open = unshippedLines(fresh)
  if (fresh.cancelledAt || (partlyShipped(fresh) && !open.length && refundIssued(fresh))) {
    // Already done — a second tap after a slow first one, or done in Shopify.
    await keep(fresh)
  } else if (!partlyShipped(fresh)) {
    let done
    try {
      done = await cancelAndRefund(c.shopifyOrderId, `Cancelled at the customer's request (support case), by ${who.name} in the Studio app.`)
    } catch (e) {
      return { ok: false, error: await fail(e instanceof Error ? e.message : String(e)) }
    }
    // Whatever happened, the card shows the order as it now is.
    const now = done.ok ? done.order : await freshOrder(c.shopifyOrderId).catch(() => null)
    if (now) await keep(now)
    if (!done.ok) {
      revalidatePath('/support')
      return { ok: false, error: `${done.error} Nothing was sent.` }
    }
    await db.supportMessage.create({
      data: {
        caseId: id, direction: 'NOTE', fromAddress: who.name,
        body: `${c.shopifyOrderName} cancelled in Shopify: ${money(done.order)} refunded to the original payment, items restocked.`,
      },
    })
  } else {
    // Part has shipped: cancel and refund what has not. See cancelUnshippedLines.
    if (!open.length) return { ok: false, error: 'Everything on this order has shipped, so nothing can be cancelled. It is a return.' }
    const location = await db.location.findFirst({ where: { isDefault: true }, select: { shopifyLocationId: true } })
    if (!location?.shopifyLocationId) return { ok: false, error: 'The studio has no Shopify location on record. Nothing was changed or sent.' }
    let done
    try {
      done = await cancelUnshippedLines(
        c.shopifyOrderId, open.map((l) => ({ lineItemId: l.id, quantity: l.quantity })),
        location.shopifyLocationId, `Not shipped; cancelled at the customer's request by ${who.name} in the Studio app.`,
      )
    } catch (e) {
      return { ok: false, error: await fail(e instanceof Error ? e.message : String(e)) }
    }
    const now = done.ok ? done.order : await freshOrder(c.shopifyOrderId).catch(() => null)
    if (now) await keep(now)
    if (!done.ok) {
      revalidatePath('/support')
      return { ok: false, error: `${done.error} Nothing was sent.` }
    }
    await db.supportMessage.create({
      data: {
        caseId: id, direction: 'NOTE', fromAddress: who.name,
        body: `Cancelled in Shopify (not shipped): ${open.map((l) => l.label).join(', ')}. ${done.refunded} refunded to the original payment. The rest of ${c.shopifyOrderName} had already shipped.`,
      },
    })
  }
  return sendReply(id, text)
}

/** Ask for a fresh draft — after the case changed, or when the first one failed. */
export async function redraftReply(id: string): Promise<void> {
  if (!(await approver())) return
  await refreshOrder(id).catch((e) => console.error('[support] order refresh', e))
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
    return { ok: false, error: /access|scope|denied|permission/i.test(msg) ? await permissionError('edit this order', 'write_order_edits', msg) : `Shopify refused: ${msg.slice(0, 160)}` }
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

/**
 * "Mouse got this wrong": a case flagged for Brandon and Claude, when the fix
 * belongs in Mouse's code or policy rather than in this one reply. Brandon,
 * 25 Sept 2026: "a button that jane can hit on CS for BC to review (meaning
 * it needs you and me reprogramming mouse)."
 *
 * Keeps the person's reason and Mouse's draft as it stood, since the draft
 * is usually what went wrong and is overwritten by the next redraft. Emails
 * Brandon unless he flagged it himself. Nothing reaches the customer.
 */
export async function flagForReview(id: string, reason: string): Promise<Result> {
  const who = await approver()
  if (!who) return { ok: false, error: 'Sign in again — only the team can do this.' }
  const why = reason.trim()
  if (!why) return { ok: false, error: 'Say in a line what Mouse got wrong.' }
  const c = await db.supportCase.findUnique({ where: { id } })
  if (!c) return { ok: false, error: 'Case not found.' }
  await db.$transaction([
    db.supportCase.update({
      where: { id },
      data: {
        reviewRequestedAt: new Date(), reviewRequestedBy: who.name, reviewReason: why.slice(0, 2000),
        reviewDraft: c.draftReply, reviewedAt: null, reviewOutcome: null,
      },
    }),
    db.supportMessage.create({ data: { caseId: id, direction: 'NOTE', fromAddress: who.name, body: `Flagged for Brandon & Claude: ${why}` } }),
  ])
  const brandon = await db.person.findFirst({ where: { email: 'brandon@cleocamp.com', active: true }, select: { id: true, email: true } })
  if (brandon?.email && brandon.id !== who.id) {
    const person = await db.person.findUnique({ where: { id: who.id }, select: { email: true } })
    const customer = c.customerName ?? c.customerEmail
    await sendEmail({
      to: [brandon.email],
      ...(person?.email ? { replyTo: person.email } : {}),
      subject: `Mouse review: ${customer}${c.shopifyOrderName ? ` · ${c.shopifyOrderName}` : ''}`,
      text:
        `${who.name} flagged ${customer}'s case for you and Claude:\n\n${why}\n\n` +
        (c.draftReply ? `Mouse's draft at the time:\n\n${c.draftReply}\n\n` : 'There was no draft at the time.\n\n') +
        `Open it: https://admin.cleocamp.com/support#${id}\n\n— Studio Mouse`,
    }).catch((e) => console.error('[support] review email failed', e))
  }
  revalidatePath('/support')
  return { ok: true }
}

/** Brandon or Claude has dealt with a flag. The outcome line says what changed. */
export async function markReviewed(id: string, outcome: string): Promise<Result> {
  const who = await approver()
  if (!who) return { ok: false, error: 'Sign in again — only the team can do this.' }
  await db.$transaction([
    db.supportCase.update({ where: { id }, data: { reviewedAt: new Date(), reviewOutcome: outcome.trim().slice(0, 2000) || null } }),
    db.supportMessage.create({ data: { caseId: id, direction: 'NOTE', fromAddress: who.name, body: `Review done${outcome.trim() ? `: ${outcome.trim()}` : '.'}` } }),
  ])
  revalidatePath('/support')
  return { ok: true }
}

// ── Returns that reach the studio ────────────────────────────────────────
// See lib/returns.ts. Each step is a person's tap; the emails are fixed text.

export type ReturnLookup =
  | { ok: false; error: string }
  | { ok: true; order: { id: string; name: string; email: string | null; customerName: string | null; items: Array<{ id: string; label: string; returnable: number }> }; caseId: string | null; alreadyReceived: boolean }

/** Find the order behind a number typed at the studio, and its case if there is one. */
export async function lookupReturn(input: string): Promise<ReturnLookup> {
  if (!(await approver())) return { ok: false, error: 'Sign in again — only the team can do this.' }
  const { findReturnOrder, orderNameFrom } = await import('@/lib/returns')
  const name = orderNameFrom(input)
  if (!name) return { ok: false, error: 'Type the order number, like 2237.' }
  let order
  try {
    order = await findReturnOrder(name)
  } catch (e) {
    return { ok: false, error: `Could not read Shopify: ${e instanceof Error ? e.message.slice(0, 160) : String(e)}` }
  }
  if (!order) return { ok: false, error: `No order ${name} in Shopify.` }
  // Only what went out and has not already been refunded can come back.
  const items = order.items
    .map((i) => ({ id: i.id, label: i.label, returnable: Math.min(i.shipped, i.refundable) }))
    .filter((i) => i.returnable > 0)
  if (!items.length) return { ok: false, error: `Nothing on ${name} has shipped and is still unrefunded, so there is nothing to return.` }
  const c = await db.supportCase.findFirst({ where: { shopifyOrderId: order.id }, orderBy: [{ status: 'asc' }, { lastMessageAt: 'desc' }] })
  const info = c?.returnInfo as { refundedAt?: string } | null
  return {
    ok: true,
    order: { id: order.id, name: order.name, email: order.email, customerName: order.customerName, items },
    caseId: c?.id ?? null,
    alreadyReceived: !!info && !info.refundedAt,
  }
}

/**
 * The parcel is in the studio: record it on the order's case (making one if
 * the customer never wrote), email the customer that it arrived, and then
 * close an exchange or leave a refund open for someone to approve.
 */
export async function receiveReturn(input: {
  orderName: string
  lines: Array<{ lineItemId: string; quantity: number }>
  kind: 'REFUND' | 'EXCHANGE'
}): Promise<Result & { caseId?: string }> {
  const who = await approver()
  if (!who) return { ok: false, error: 'Sign in again — only the team can do this.' }
  const found = await lookupReturn(input.orderName)
  if (!found.ok) return found
  const { order } = found
  const lines = input.lines
    .filter((l) => l.quantity > 0)
    .map((l) => {
      const item = order.items.find((i) => i.id === l.lineItemId)
      return item ? { lineItemId: item.id, quantity: Math.min(Math.round(l.quantity), item.returnable), label: item.label } : null
    })
    .filter((l): l is { lineItemId: string; quantity: number; label: string } => !!l && l.quantity > 0)
  if (!lines.length) return { ok: false, error: 'Tick what came back.' }
  if (!order.email) return { ok: false, error: `${order.name} has no email on it, so the customer cannot be told. Handle it in Shopify.` }

  const { returnReceivedText } = await import('@/lib/returns')
  const first = order.customerName?.trim().split(/\s+/)[0] ?? null
  let caseId = found.caseId
  if (!caseId) {
    const snap = await freshOrder(order.id).catch(() => null)
    const c = await db.supportCase.create({
      data: {
        customerEmail: order.email.toLowerCase(), customerName: first, subject: `Your return for ${order.name}`,
        category: 'RETURN_EXCHANGE', urgency: 'DIGEST', status: 'OPEN',
        summary: `Return received at the studio for ${order.name}.`,
        shopifyOrderName: order.name, shopifyOrderId: order.id,
        orderSnapshot: snap ? (snap as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
      },
    })
    caseId = c.id
  }
  const info = { orderId: order.id, orderName: order.name, kind: input.kind, lines, receivedAt: new Date().toISOString(), receivedBy: who.name }
  await db.$transaction([
    db.supportCase.update({ where: { id: caseId }, data: { returnInfo: info as unknown as Prisma.InputJsonValue } }),
    db.supportMessage.create({
      data: {
        caseId, direction: 'NOTE', fromAddress: who.name,
        body: `Return received at the studio: ${lines.map((l) => `${l.quantity} × ${l.label}`).join(', ')}. ${input.kind === 'REFUND' ? 'Refund to approve once it has been checked.' : 'Exchange: send the replacement.'}`,
      },
    }),
  ])
  const sent = await sendReply(caseId, returnReceivedText(first, info))
  if (!sent.ok) return { ok: false, error: `Recorded, but the email did not go: ${sent.error}` }
  // A refund waits, open, for someone to approve it; an exchange is done here.
  await db.supportCase.update({
    where: { id: caseId },
    data: input.kind === 'REFUND' ? { status: 'OPEN', resolvedAt: null, urgency: 'TODAY' } : { status: 'RESOLVED', resolvedAt: new Date() },
  })
  revalidatePath('/support')
  revalidatePath('/products')
  return { ok: true, caseId }
}

async function studioLocation(): Promise<string | null> {
  const l = await db.location.findFirst({ where: { isDefault: true }, select: { shopifyLocationId: true } })
  return l?.shopifyLocationId ?? null
}

/** What approving the refund on this case would pay back. Changes nothing. */
export async function quoteCaseRefund(caseId: string): Promise<{ ok: true; refund: number; fee: number } | { ok: false; error: string }> {
  if (!(await approver())) return { ok: false, error: 'Sign in again — only the team can do this.' }
  const c = await db.supportCase.findUnique({ where: { id: caseId } })
  const info = c?.returnInfo as import('@/lib/returns').ReturnInfo | null
  if (!info || info.kind !== 'REFUND' || info.refundedAt) return { ok: false, error: 'No refund waiting on this case.' }
  const loc = await studioLocation()
  if (!loc) return { ok: false, error: 'The studio has no Shopify location on record.' }
  const { quoteReturnRefund } = await import('@/lib/returns')
  try {
    const q = await quoteReturnRefund(info.orderId, info.lines, loc)
    return { ok: true, refund: q.refund, fee: q.fee }
  } catch (e) {
    return { ok: false, error: `Shopify could not work it out: ${e instanceof Error ? e.message.slice(0, 160) : String(e)}` }
  }
}

/** Approved: refund less the fee, restock, email the customer, close. */
export async function approveReturnRefund(caseId: string): Promise<Result> {
  const who = await approver()
  if (!who) return { ok: false, error: 'Sign in again — only the team can do this.' }
  const c = await db.supportCase.findUnique({ where: { id: caseId } })
  const info = c?.returnInfo as import('@/lib/returns').ReturnInfo | null
  if (!c || !info || info.kind !== 'REFUND') return { ok: false, error: 'No refund waiting on this case.' }
  if (info.refundedAt) return { ok: false, error: `Already refunded on ${info.refundedAt.slice(0, 10)}.` }
  const loc = await studioLocation()
  if (!loc) return { ok: false, error: 'The studio has no Shopify location on record. Nothing was refunded.' }
  const { refundReturn, returnRefundedText } = await import('@/lib/returns')
  let q
  try {
    q = await refundReturn(info.orderId, info.lines, loc, `return-${info.orderId.split('/').pop()}-${caseId}`, `Return, less 10% restocking fee. Approved by ${who.name} in the Studio app.`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: /access|scope|denied|permission/i.test(msg) ? await permissionError('refund this return', 'write_orders', msg) : `Shopify refused: ${msg.slice(0, 200)}. Nothing was sent.` }
  }
  const done = { ...info, refundedAt: new Date().toISOString(), refunded: q.refund, fee: q.fee }
  const now = await freshOrder(info.orderId).catch(() => null)
  await db.$transaction([
    db.supportCase.update({
      where: { id: caseId },
      data: { returnInfo: done as unknown as Prisma.InputJsonValue, ...(now ? { orderSnapshot: now as unknown as Prisma.InputJsonValue } : {}) },
    }),
    db.supportMessage.create({
      data: { caseId, direction: 'NOTE', fromAddress: who.name, body: `Refunded $${q.refund.toFixed(2)} in Shopify (10% restocking fee of $${q.fee.toFixed(2)} kept); items back in the studio's stock.` },
    }),
  ])
  const sent = await sendReply(caseId, returnRefundedText(c.customerName, info.orderName, q))
  await db.supportCase.update({ where: { id: caseId }, data: { status: 'RESOLVED', resolvedAt: new Date() } })
  revalidatePath('/support')
  return sent.ok ? { ok: true } : { ok: false, error: `Refunded, but the email did not go: ${sent.error}` }
}

/**
 * Any order's status by number, for the lookup box at the top of Support.
 * Read only. Brandon, 29 Sept 2026.
 */
export async function lookupOrder(input: string): Promise<
  { ok: true; order: import('@/lib/order-status').OrderStatus; caseId: string | null } | { ok: false; error: string }
> {
  if (!(await approver())) return { ok: false, error: 'Sign in again — only the team can do this.' }
  const { orderStatus, orderName } = await import('@/lib/order-status')
  const name = orderName(input)
  if (!name) return { ok: false, error: 'Type the order number, like 2237.' }
  try {
    const order = await orderStatus(name)
    if (!order) return { ok: false, error: `No order ${name} in Shopify.` }
    const c = await db.supportCase.findFirst({ where: { shopifyOrderName: name }, orderBy: { lastMessageAt: 'desc' }, select: { id: true } }).catch(() => null)
    return { ok: true, order, caseId: c?.id ?? null }
  } catch (e) {
    return { ok: false, error: `Could not read Shopify: ${e instanceof Error ? e.message.slice(0, 160) : String(e)}` }
  }
}
