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
export async function addCaseNote(id: string, text: string) {
  if (!text.trim()) return
  const who = await currentPersonId()
  const person = who ? await db.person.findUnique({ where: { id: who }, select: { name: true, email: true } }) : null
  const note = await db.supportMessage.create({
    data: { caseId: id, direction: 'NOTE', fromAddress: person?.name ?? null, body: text.trim() },
  })
  const jane = await db.person.findFirst({ where: { email: 'jane@cleocamp.com', active: true }, select: { email: true } })
  if (jane?.email && person?.email?.toLowerCase() !== jane.email) {
    const c = await db.supportCase.findUnique({ where: { id }, select: { customerName: true, customerEmail: true, subject: true, shopifyOrderName: true } })
    if (c) {
      const who = c.customerName ?? c.customerEmail
      await sendEmail({
        to: [jane.email],
        ...(person?.email ? { replyTo: person.email } : {}),
        subject: `Support note from ${person?.name ?? 'the team'}: ${who}${c.shopifyOrderName ? ` · ${c.shopifyOrderName}` : ''}`,
        text:
          `${person?.name ?? 'Someone on the team'} left a note on ${who}'s case${c.subject ? ` ("${c.subject}")` : ''}:\n\n` +
          `${text.trim()}\n\n` +
          `Open it: https://admin.cleocamp.com/support#${id}\n\n` +
          `Nothing has been sent to the customer.\n— Studio Mouse`,
      })
        // Marked only once it went, so the page never shows a note as sent that was not.
        .then(() => db.supportMessage.update({ where: { id: note.id }, data: { emailedTo: jane.email } }))
        .catch((e) => console.error('[support] note email failed', e))
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
