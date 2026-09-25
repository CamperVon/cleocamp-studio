import Anthropic from '@anthropic-ai/sdk'
import { db } from '@/lib/db'
import { Prisma } from '@/generated/prisma/client'
import { CHAT_MODEL } from '@/lib/mouse/agent'
import { recordUsage, usageOf } from '@/lib/mouse/usage'
import type { OrderSnapshot } from '@/lib/support/orders'
import { addressChangeProblems, DRAFT_INSTRUCTIONS, orderFacts, parseDraft } from '@/lib/support/reply'

/**
 * Write (or rewrite) the drafted reply on one case.
 *
 * Same rule as the reader in pass.ts: this model has NO tools. It sees the
 * conversation, the order facts code looked up, and the policy, and returns
 * text. What it drafts is stored for a person to read — it cannot reach the
 * customer, Shopify or the database by itself.
 *
 * Spam and closed cases are not drafted. A failure leaves the case with no
 * draft, which the card shows as "no draft" — never a half-written one.
 */
export async function draftForCase(caseId: string): Promise<void> {
  const c = await db.supportCase.findUnique({
    where: { id: caseId },
    include: { messages: { orderBy: { createdAt: 'asc' }, take: 12 } },
  })
  if (!c || c.category === 'SPAM' || c.status === 'RESOLVED') return

  const order = (c.orderSnapshot as OrderSnapshot | null) ?? null
  const thread = c.messages
    .filter((m) => m.direction !== 'NOTE')
    .map((m) => `${m.direction === 'INBOUND' ? 'CUSTOMER' : 'US'} (${m.createdAt.toISOString().slice(0, 10)}):\n${m.body.slice(0, 2500)}`)
    .join('\n---\n')

  const [stock, examples] = await Promise.all([stockFacts(order).catch(() => ''), recentReplies(caseId).catch(() => '')])
  let raw = ''
  try {
    const startedAt = Date.now()
    const res = await new Anthropic().messages.create({
      model: CHAT_MODEL,
      max_tokens: 1500,
      system: DRAFT_INSTRUCTIONS,
      output_config: { effort: 'low' },
      messages: [{
        role: 'user',
        content:
          `Today is ${new Date().toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: 'long', day: 'numeric' })}.\n` +
          `Customer: ${c.customerName ?? 'name unknown'} <${c.customerEmail}>. Sorted as: ${c.category}.\n\n` +
          `ORDER FACTS (from Shopify, checked by code):\n${orderFacts(order)}\n\n` +
          (stock ? `STOCK FACTS for items not yet shipped (from our records):\n${stock}\n\n` : '') +
          (examples ? `${examples}\n\n` : '') +
          `<conversation>\n${thread.slice(-9000)}\n</conversation>\n\n` +
          `Draft the reply to the customer's latest email.`,
      }],
    })
    await recordUsage('support-draft', [usageOf(CHAT_MODEL, res.usage, startedAt)])
    raw = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('')
  } catch (e) {
    console.error('[support] draft failed', caseId, e)
    return
  }

  const d = parseDraft(raw)
  if (!d) return
  // The checks are run and stored now so the card can show them, and run
  // again against a fresh read of the order at the moment someone taps.
  const address = d.newAddress
    ? { to: d.newAddress, from: order?.shipTo ?? null, problems: addressChangeProblems(order, c.customerEmail, d.newAddress) }
    : null
  await db.supportCase.update({
    where: { id: caseId },
    data: {
      draftReply: d.reply,
      draftNeeds: d.needs,
      draftAddress: address ? (address as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
      draftedAt: new Date(),
    },
  })
}

/**
 * What the studio knows about getting each unshipped item to the customer:
 * how many are in stock, and when more are expected. Brandon, 24 Sept 2026,
 * after Tracy's reply said nothing about her Black / 1 tee being sold 118
 * ahead of stock: Mouse should say that itself.
 *
 * Read from our own records by code and handed to the drafter as facts. An
 * expected date is marked as confirmed or not, and the policy lets the draft
 * give it only as an estimate.
 */
export async function stockFacts(order: OrderSnapshot | null): Promise<string> {
  const open = (order?.items ?? []).filter((i) => (i.unfulfilled ?? 0) > 0 && i.variantId)
  if (!open.length) return ''
  const ids = open.map((i) => i.variantId!.split('/').pop()!)
  const variants = await db.productVariant.findMany({
    where: { shopifyVariantId: { in: ids } },
    select: { id: true, shopifyVariantId: true, onHandQty: true, productId: true },
  })
  const productIds = [...new Set(variants.map((v) => v.productId))]
  const [pos, runs] = await Promise.all([
    db.purchaseOrder.findMany({
      where: {
        status: { in: ['SENT', 'PARTIALLY_RECEIVED'] },
        // Only orders that bring the finished item itself — a line for this
        // exact variant. A fabric or label PO tagged to the same product
        // (RichLine, L&L) says nothing about when a tee reaches a customer.
        lines: { some: { productVariantId: { in: variants.map((v) => v.id) } } },
      },
      select: { poNumber: true, expectedAt: true, lines: { select: { productVariantId: true } } },
    }),
    db.productionRun.findMany({
      where: { productId: { in: productIds }, status: { notIn: ['RECEIVED', 'CANCELLED'] } },
      select: { productId: true, expectedReadyAt: true, dateConfirmed: true, status: true },
    }),
  ])
  const day = (d: Date) => d.toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: 'long', day: 'numeric' })

  return open.map((i) => {
    const v = variants.find((x) => x.shopifyVariantId === i.variantId!.split('/').pop())
    const label = `${i.title}${i.variant ? ` (${i.variant})` : ''}`
    if (!v) return `- ${label}: not in our records — no stock facts.`
    const onHand = v.onHandQty === null ? null : Number(v.onHandQty)
    const stock = onHand === null ? 'stock not counted' : onHand > 0 ? `${onHand} in stock — can ship` : 'none in stock (sold ahead of stock)'
    const dates = [
      ...runs.filter((r) => r.productId === v.productId && r.expectedReadyAt)
        .map((r) => `a production run ${r.status.toLowerCase().replace(/_/g, ' ')}, ready ${day(r.expectedReadyAt!)}${r.dateConfirmed ? '' : ' (estimate, not confirmed)'}`),
      ...pos.filter((p) => p.expectedAt && p.lines.some((l) => l.productVariantId === v.id))
        .map((p) => `PO ${p.poNumber} expected ${day(p.expectedAt!)} (estimate)`),
    ]
    return `- ${label}: ${stock}.${onHand !== null && onHand > 0 ? '' : dates.length ? ` More coming: ${dates.join('; ')}.` : ' No date on file for more.'}`
  }).join('\n')
}

/**
 * Replies the team actually sent to other customers, newest first, as
 * examples of how the studio writes. Brandon, 25 Sept 2026: "Does Mouse learn
 * from any human edits we make to the CS emails?" It did not: the drafter saw
 * only the written policy, and the draft was thrown away on Send. Now the
 * final text of each sent reply is the example, and where a person changed
 * Mouse's draft that is said, because those are the replies that show what the
 * policy alone gets wrong.
 *
 * These are the team's own words, not a customer's, so they add nothing
 * untrusted. Only phrasing is to be taken from them; every fact in them
 * belongs to another customer.
 */
export async function recentReplies(caseId: string, take = 8): Promise<string> {
  const sent = await db.supportMessage.findMany({
    where: { direction: 'OUTBOUND', caseId: { not: caseId }, NOT: { fromAddress: 'Auto-reply' } },
    orderBy: { createdAt: 'desc' },
    take,
    select: { body: true, draftedText: true },
  })
  if (!sent.length) return ''
  const edited = (m: { body: string; draftedText: string | null }) =>
    m.draftedText !== null && m.draftedText.trim() !== m.body.trim()
  return [
    'HOW THE STUDIO ACTUALLY WRITES: replies the team sent to other customers, newest first. ' +
      'Match their voice, length and phrasing. Take NO facts from them (names, orders, dates, items): ' +
      'those belong to other customers. Where a reply says a person rewrote the draft, their version ' +
      'is the one to learn from.',
    ...sent.map((m, i) => `--- Example ${i + 1}${edited(m) ? ' (a person rewrote the draft before sending)' : ''}\n${m.body.slice(0, 1500)}`),
  ].join('\n')
}
