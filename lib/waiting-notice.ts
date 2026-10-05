import { db } from '@/lib/db'
import { shopifyGraphQL } from '@/lib/integrations/shopify'
import { sendEmail } from '@/lib/email'
import { SUPPORT_FROM, SUPPORT_REPLY_TO } from '@/lib/support/reply'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { noticeHtml, type NoticePicture } from '@/lib/notice-pictures'

/**
 * "Message everyone waiting": one email to each customer whose open order
 * still has an unshipped piece of a product, in chosen colours. Brandon,
 * 4 Oct 2026: Cleo needs to email everyone who ordered a Black or White Cleo
 * Tee that has not shipped yet, "without shopify screwing something up".
 *
 * So Shopify is only read, never written: no tags, no order edits (which can
 * trigger Shopify's own "your order was updated" email), nothing marked
 * fulfilled, nothing cancelled. The words are Cleo's, sent exactly as she
 * wrote them, with only the placeholders filled in by code: no model writes
 * or varies customer-facing text. Each send is recorded per order
 * (CustomerNotice), so a second tap, or a send resumed after a timeout,
 * never emails anyone twice. Shopify Email was ruled out because it only
 * reaches customers subscribed to marketing: 27 of the first 50 were not.
 */

export type WaitingLine = { title: string; variantTitle: string | null; unfulfilledQuantity: number }
export type WaitingOrder = { orderId: string; name: string; email: string; firstName: string | null; items: string[] }
export type Match = { product: string; colours: string[] }

const norm = (s: string) => s.trim().toLowerCase()

/**
 * The unshipped pieces of an order that match, as a person would say them:
 * "Black, size 1". Matches the product title exactly (so "Cleo Tee - Splish"
 * is a different listing, not a Cleo Tee) and the colour before the " / ".
 * Pure.
 */
export function waitingItems(lines: WaitingLine[], m: Match): string[] {
  const colours = new Set(m.colours.map(norm))
  const out: string[] = []
  for (const l of lines) {
    if (norm(l.title) !== norm(m.product) || l.unfulfilledQuantity <= 0) continue
    const [colour, size] = (l.variantTitle ?? '').split(' / ').map((s) => s?.trim())
    if (!colour || !colours.has(norm(colour))) continue
    const label = `${colour} ${m.product}${size ? `, size ${size}` : ''}`
    out.push(l.unfulfilledQuantity > 1 ? `${l.unfulfilledQuantity} × ${label}` : label)
  }
  return out
}

/**
 * The name to greet a customer by, or null for "there". Shopify keeps a
 * first name on the customer account, the billing address and the shipping
 * address, and they are not always the person reading. On 5 Oct 2026, #2289
 * (vanessatraina@…) had Charles on the account and card and Vanessa on the
 * parcel; #2347 had Katherine on the account and Katy on card and parcel;
 * #2332's parcel just said "G". So, in order:
 *   1. the name the email address itself contains (whose inbox it is);
 *   2. the name, if every one given agrees;
 *   3. the name on the card, if the parcel says the same (the account is
 *      the stalest of the three);
 *   4. the name on the account and the card, if the email address starts
 *      with its letter (#2425: Suzanne twice, "Master" on the parcel,
 *      suzyz@…), but not #2297: Joshua twice, inbox stephmbank@…;
 *   5. none, since "Hi there" is never wrong and the wrong name always is.
 * Initials are dropped ("Laura H." is Laura, "G" and "LC" are nobody). A
 * name typed all in lower or upper case reads as a name. Pure.
 */
export function greetingName(n: { account?: string | null; billing?: string | null; shipping?: string | null }, email: string): string | null {
  const clean = (x?: string | null) => {
    const words = (x ?? '').trim().split(/\s+/).filter((w) => !/^\p{L}\.?$/u.test(w) && !/^\p{Lu}{2}\.?$/u.test(w))
    const name = words.join(' ')
    return /^\p{L}{2}[\p{L}'’ -]*$/u.test(name) ? name : ''
  }
  const key = (x: string) => x.toLowerCase().replace(/[^\p{L}]/gu, '')
  const account = clean(n.account), billing = clean(n.billing), shipping = clean(n.shipping)
  const given = [account, billing, shipping].filter(Boolean)
  if (!given.length) return null
  const local = key(email.split('@')[0])
  const inEmail = [...new Set(given.map((g) => key(g.split(' ')[0])))].filter((k) => k.length >= 3 && local.includes(k))
  const distinct = new Set(given.map(key))
  const pickKey =
    inEmail.length === 1 ? inEmail[0]
    : distinct.size === 1 ? [...distinct][0]
    : billing && shipping && key(billing) === key(shipping) ? key(billing)
    : account && billing && key(account) === key(billing) && local.startsWith(key(billing).charAt(0)) ? key(billing)
    : null
  if (!pickKey) return null
  const same = given.filter((g) => key(g) === pickKey || key(g.split(' ')[0]) === pickKey)
  // Prefer a spelling with capitals; the whole name when all agree, else its first word.
  const chosen = same.find((g) => g !== g.toLowerCase()) ?? same[0]
  const out = distinct.size === 1 || key(chosen) === pickKey ? chosen : chosen.split(' ')[0]
  // "sarah" and "MYA" read as Sarah and Mya.
  return out === out.toLowerCase() || out === out.toUpperCase()
    ? out.toLowerCase().replace(/(^|[\s'’-])(\p{L})/gu, (_, sep: string, c: string) => sep + c.toUpperCase())
    : out
}

/** "A", "A and B", "A, B and C". Pure. */
function listOf(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/**
 * Cleo's message for one customer. {first_name}, {order} and {items} are
 * filled in; nothing else changes. A missing first name reads "there", so
 * "Hi {first_name}," becomes "Hi there,". Pure.
 */
export function renderNotice(template: string, o: Pick<WaitingOrder, 'name' | 'firstName' | 'items'>): string {
  return template
    .replace(/\{\s*first_name\s*\}/gi, o.firstName?.trim() || 'there')
    .replace(/\{\s*order\s*\}/gi, o.name)
    .replace(/\{\s*items\s*\}/gi, listOf(o.items))
}

/** Which notice a send belongs to, for "never twice". Pure. */
export function campaignKey(m: Match, subject: string): string {
  return `${norm(m.product)}|${m.colours.map(norm).sort().join(',')}|${subject.trim()}`
}

type OrdersPage = {
  orders: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null }
    nodes: Array<{
      id: string; name: string; email: string | null; cancelledAt: string | null; displayFinancialStatus: string | null
      customer: { firstName: string | null } | null
      billingAddress: { firstName: string | null } | null
      shippingAddress: { firstName: string | null } | null
      lineItems: { nodes: WaitingLine[] }
    }>
  }
}

/** Every open order still waiting on a matching piece, oldest first. Read-only. */
export async function findWaiting(m: Match): Promise<WaitingOrder[]> {
  const out: WaitingOrder[] = []
  let after: string | null = null
  for (let page = 0; page < 40; page++) {
    const d: OrdersPage = await shopifyGraphQL<OrdersPage>(
      `query($after: String) {
        orders(first: 100, after: $after, sortKey: CREATED_AT,
               query: "status:open AND (fulfillment_status:unshipped OR fulfillment_status:partial)") {
          pageInfo { hasNextPage endCursor }
          nodes {
            id name email cancelledAt displayFinancialStatus
            customer { firstName }
            billingAddress { firstName }
            shippingAddress { firstName }
            lineItems(first: 50) { nodes { title variantTitle unfulfilledQuantity } }
          }
        }
      }`,
      { after },
    )
    for (const o of d.orders.nodes) {
      if (o.cancelledAt || !o.email) continue
      if (o.displayFinancialStatus === 'REFUNDED' || o.displayFinancialStatus === 'VOIDED') continue
      const items = waitingItems(o.lineItems.nodes, m)
      const email = o.email.trim()
      const firstName = greetingName({ account: o.customer?.firstName, billing: o.billingAddress?.firstName, shipping: o.shippingAddress?.firstName }, email)
      if (items.length) out.push({ orderId: o.id, name: o.name, email, firstName, items })
    }
    if (!d.orders.pageInfo.hasNextPage) break
    after = d.orders.pageInfo.endCursor
  }
  return out
}

/** Who is waiting, who has already been sent this notice, and one filled-in example. */
export async function previewNotice(m: Match, subject: string, template: string) {
  const waiting = await findWaiting(m)
  const done = await db.customerNotice.findMany({
    where: { campaign: campaignKey(m, subject), status: 'sent' },
    select: { orderId: true },
  })
  const sent = new Set(done.map((d) => d.orderId))
  const toSend = waiting.filter((o) => !sent.has(o.orderId))
  const sample = toSend[0] ?? waiting[0]
  return {
    waiting: waiting.length,
    alreadySent: waiting.length - toSend.length,
    toSend: toSend.length,
    orders: toSend.map((o) => `${o.name} · ${o.items.join(', ')}`),
    sample: sample ? { to: sample.email, order: sample.name, text: renderNotice(template, sample) } : null,
  }
}

/**
 * The words as text and HTML, with the pictures (if any) attached inline
 * below them. Read once per send, before anyone is emailed: a missing
 * picture stops the send rather than going out without it.
 */
async function bodies(picture: NoticePicture | null) {
  const attachments = picture
    ? await Promise.all(picture.images.map(async (img) => ({
        filename: img.file,
        content: await readFile(path.join(process.cwd(), 'public', 'notice', img.file)),
        contentId: img.cid,
      })))
    : undefined
  return (text: string) => ({ text, ...(picture ? { html: noticeHtml(text, picture), attachments } : {}) })
}

/** One customer's email, sent to someone else as a test. Records nothing. */
export async function sendNoticeTest(m: Match, subject: string, template: string, testTo: string, picture: NoticePicture | null = null, rootFrom = false) {
  const [sample] = await findWaiting(m)
  if (!sample) return { sent: false, reason: 'Nobody is waiting on that.' }
  const body = await bodies(picture)
  const res = await sendEmail({
    ...sender(rootFrom), to: [testTo], replyTo: SUPPORT_REPLY_TO,
    subject: `[TEST, as ${sample.name} would get it] ${subject}`,
    ...body(renderNotice(template, sample)),
  })
  return res.sent ? { sent: true } : { sent: false, reason: 'reason' in res ? res.reason : 'not sent' }
}

/**
 * Cleo's own address, for one send when a person ticks it on Special
 * (Brandon, 4 Oct 2026: "a one time thing"). Needs cleocamp.com verified in
 * Resend; until then the test send says so. lib/email.ts refuses it anywhere else.
 */
export const ROOT_FROM = 'Cleo <support@cleocamp.com>'
const sender = (rootFrom: boolean) => (rootFrom ? { from: ROOT_FROM, personChoseRootFrom: true } : { from: SUPPORT_FROM })

const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Take an order for this send: new, or a failed one being retried. False if someone else has it. */
async function claim(campaign: string, o: WaitingOrder, sentById: string | null): Promise<boolean> {
  try {
    await db.customerNotice.create({ data: { campaign, orderId: o.orderId, orderName: o.name, email: o.email, status: 'sending', sentById } })
    return true
  } catch {
    const r = await db.customerNotice.updateMany({ where: { campaign, orderId: o.orderId, status: 'failed' }, data: { status: 'sending', error: null, sentById } })
    return r.count === 1
  }
}

/**
 * Send to the next `max` customers not yet sent this notice. Called in a
 * loop by the page so no one request runs long. Spaced out because Resend
 * allows about two sends a second. Each order is claimed before its send, so
 * two taps at once cannot both email it.
 */
export async function sendNoticeChunk(m: Match, subject: string, template: string, sentById: string | null, max = 20, picture: NoticePicture | null = null, rootFrom = false) {
  const campaign = campaignKey(m, subject)
  const body = await bodies(picture)
  const waiting = await findWaiting(m)
  // Sent, or mid-send when a request timed out (left alone: it may have
  // gone, and never twice beats once more). A failed one is tried again.
  const done = new Set((await db.customerNotice.findMany({ where: { campaign, status: { not: 'failed' } }, select: { orderId: true } })).map((d) => d.orderId))
  const next = waiting.filter((o) => !done.has(o.orderId)).slice(0, max)
  let sent = 0
  const failed: string[] = []
  for (const o of next) {
    if (!(await claim(campaign, o, sentById))) continue // another tap has it
    const text = renderNotice(template, o)
    const res = await sendEmail({ ...sender(rootFrom), to: [o.email], replyTo: SUPPORT_REPLY_TO, subject, ...body(text) })
    if (res.sent) {
      sent++
      await db.$transaction([
        db.customerNotice.update({ where: { campaign_orderId: { campaign, orderId: o.orderId } }, data: { status: 'sent', resendId: 'id' in res ? String(res.id ?? '') : null } }),
        db.sentEmail.create({ data: { toAddress: o.email, subject, body: picture ? `${text}\n\n[Pictures: ${picture.label}]` : text, sentBy: sentById, resendId: 'id' in res ? String(res.id ?? '') : null } }),
      ])
    } else {
      failed.push(o.name)
      await db.customerNotice.update({
        where: { campaign_orderId: { campaign, orderId: o.orderId } },
        data: { status: 'failed', error: 'reason' in res ? String(res.reason) : 'not sent' },
      })
    }
    await pause(600)
  }
  const remaining = waiting.filter((o) => !done.has(o.orderId)).length - next.length
  return { sent, failed, remaining: Math.max(0, remaining) }
}
