import Anthropic from '@anthropic-ai/sdk'
import { db } from '@/lib/db'
import { Prisma } from '@/generated/prisma/client'
import { CHAT_MODEL } from '@/lib/mouse/agent'
import { recordUsage, usageOf } from '@/lib/mouse/usage'
import { findOrder, type OrderSnapshot } from '@/lib/support/orders'
import { isConfigured, shopifyGraphQL } from '@/lib/integrations/shopify'
import { addressChangeProblems, DRAFT_INSTRUCTIONS, orderFacts, parseDraft } from '@/lib/support/reply'
import { orderNumbersIn, trimQuoted } from '@/lib/support/core'

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
    .map((m) => `${m.direction === 'INBOUND' ? 'CUSTOMER' : 'US'} (${m.createdAt.toISOString().slice(0, 10)}):\n${trimQuoted(m.body).text.slice(0, 2500)}`)
    .join('\n---\n')

  const latest = c.messages.filter((m) => m.direction === 'INBOUND').slice(-3).map((m) => trimQuoted(m.body).text).join('\n')
  const [stock, catalog, examples] = await Promise.all([
    stockFacts(order).catch(() => ''),
    catalogFacts(`${c.subject ?? ''}\n${latest}`).catch((e) => { console.error('[support] catalog facts', e); return '' }),
    recentReplies(caseId).catch(() => ''),
  ])
  // Asked up to twice: a reply that cannot be read as a draft is asked for
  // again once, then left as a note on the case, never silently dropped.
  let d: ReturnType<typeof parseDraft> = null
  let raw = ''
  for (let attempt = 0; attempt < 2 && !d; attempt++) {
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
            (catalog ? `CATALOG FACTS for products the customer names (from the shop, just now):\n${catalog}\n\n` : '') +
            (examples ? `${examples}\n\n` : '') +
            `<conversation>\n${thread.slice(-9000)}\n</conversation>\n\n` +
            `Draft the reply to the customer's latest email.`,
        }],
      })
      await recordUsage('support-draft', [usageOf(CHAT_MODEL, res.usage, startedAt)])
      raw = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('')
    } catch (e) {
      console.error('[support] draft failed', caseId, e)
      raw = ''
    }
    d = parseDraft(raw)
  }
  if (!d) {
    const body = "Mouse couldn't write a draft for this one. Tap \"Draft a reply\" to try again, or write it yourself."
    const said = await db.supportMessage.findFirst({ where: { caseId, direction: 'NOTE', body }, select: { id: true } })
    if (!said) await db.supportMessage.create({ data: { caseId, direction: 'NOTE', body } })
    console.error('[support] draft unreadable', caseId, raw.slice(0, 300))
    return
  }
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
  if (order?.emailMismatch && !order.sameName) return ''
  const open = (order?.items ?? []).filter((i) => (i.unfulfilled ?? 0) > 0 && i.variantId)
  if (!open.length) return ''
  const ids = open.map((i) => i.variantId!.split('/').pop()!)
  const variants = await db.productVariant.findMany({
    where: { shopifyVariantId: { in: ids } },
    select: { id: true, shopifyVariantId: true, onHandQty: true, productId: true },
  })
  const more = await restockDates(variants)

  return open.map((i) => {
    const v = variants.find((x) => x.shopifyVariantId === i.variantId!.split('/').pop())
    const label = `${i.title}${i.variant ? ` (${i.variant})` : ''}`
    if (!v) return `- ${label}: not in our records — no stock facts.`
    const onHand = v.onHandQty === null ? null : Number(v.onHandQty)
    const stock = onHand === null ? 'stock not counted' : onHand > 0 ? `${onHand} in stock — can ship` : 'none in stock (sold ahead of stock)'
    const dates = more(v)
    return `- ${label}: ${stock}.${onHand !== null && onHand > 0 ? '' : dates.length ? ` More coming: ${dates.join('; ')}.` : ' No date on file for more.'}`
  }).join('\n')
}

/**
 * When more of a variant is expected: open production runs for its product,
 * and open POs with a line for that exact variant. A fabric or label PO
 * tagged to the same product (RichLine, L&L) says nothing about when a tee
 * reaches a customer, so it is not counted.
 */
async function restockDates(variants: Array<{ id: string; productId: string }>): Promise<(v: { id: string; productId: string }) => string[]> {
  const productIds = [...new Set(variants.map((v) => v.productId))]
  const [pos, runs] = await Promise.all([
    db.purchaseOrder.findMany({
      where: { status: { in: ['SENT', 'PARTIALLY_RECEIVED'] }, lines: { some: { productVariantId: { in: variants.map((v) => v.id) } } } },
      select: { poNumber: true, expectedAt: true, lines: { select: { productVariantId: true } } },
    }),
    db.productionRun.findMany({
      where: { productId: { in: productIds }, status: { notIn: ['RECEIVED', 'CANCELLED'] } },
      select: { productId: true, expectedReadyAt: true, dateConfirmed: true, status: true },
    }),
  ])
  const day = (d: Date) => d.toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: 'long', day: 'numeric' })
  return (v) => [
    ...runs.filter((r) => r.productId === v.productId && r.expectedReadyAt)
      .map((r) => `a production run ${r.status.toLowerCase().replace(/_/g, ' ')}, ready ${day(r.expectedReadyAt!)}${r.dateConfirmed ? '' : ' (estimate, not confirmed)'}`),
    ...pos.filter((p) => p.expectedAt && p.lines.some((l) => l.productVariantId === v.id))
      .map((p) => `PO ${p.poNumber} expected ${day(p.expectedAt!)} (estimate)`),
  ]
}

type CatalogProduct = {
  title: string
  status: string
  variants: { nodes: Array<{ id: string; title: string; availableForSale: boolean; inventoryPolicy: string; inventoryQuantity: number | null }> }
}

/**
 * What the shop has of any product the customer names, read live from
 * Shopify: whether each size can be bought on the site now, in stock or as a
 * pre-order, plus any restock date we hold. Brandon, 25 Sept 2026, on JJ
 * asking "Is the red Cleo tee available in size 1?": Mouse should answer it,
 * not ask for an order. Stock facts were only ever built from an order's
 * items, so a question with no order had nothing to go on.
 *
 * A product counts as named when its name (before any " - Colour") is in the
 * email: "red Cleo tee" names Cleo Tee and every Cleo Tee colour product.
 */
/** Products whose name, before any " - Colour", appears in the text. Pure. */
export function namedProducts<P extends { title: string }>(products: P[], text: string): P[] {
  const t = text.toLowerCase().replace(/\s+/g, ' ')
  const base = (title: string) => title.split(/\s[-—–]\s/)[0].trim().toLowerCase()
  return products.filter((p) => base(p.title).length >= 4 && t.includes(base(p.title)))
}

/** Can a customer buy this size on the site right now, and how. Pure. */
export function saleState(onSite: boolean, v: { availableForSale: boolean; inventoryPolicy: string; inventoryQuantity: number | null }): string {
  if (!onSite || !v.availableForSale) return 'sold out, cannot be ordered'
  if ((v.inventoryQuantity ?? 0) > 0) return 'in stock'
  return v.inventoryPolicy === 'CONTINUE' ? 'sold out, but can be ordered now as a pre-order and ships when more arrive' : 'sold out'
}

/** Sizes a customer mentions: "size 1", "a 2", "size small". Pure. */
export function sizesIn(text: string): string[] {
  const words: Record<string, string> = { zero: '0', one: '1', two: '2', three: '3' }
  const found = [...text.toLowerCase().matchAll(/\bsize\s*(?:is\s*)?(\d|zero|one|two|three|x?s|m|l|small|medium|large|extra small|petite)\b/g)]
    .map((m) => words[m[1]] ?? m[1])
  return [...new Set(found)]
}

/**
 * For each size the customer named, the colours of the same product that can
 * ship now. Brandon, 25 Sept 2026, on Gasira asking for black and white in a
 * size 1 before 8 October: "a smart mouse would see if any colors are in
 * stock in her size." Worked out here rather than left to the drafter to spot
 * in a list. Pure.
 */
export function inStockInSize(products: CatalogProduct[], sizes: string[]): string[] {
  const family = (title: string) => title.split(/\s[-—–]\s/)[0].trim()
  const lines: string[] = []
  for (const fam of [...new Set(products.map((p) => family(p.title)))]) {
    for (const size of sizes) {
      const colours = products
        .filter((p) => family(p.title) === fam && p.status === 'ACTIVE')
        .flatMap((p) => p.variants.nodes)
        .filter((v) => v.availableForSale && (v.inventoryQuantity ?? 0) > 0)
        .filter((v) => v.title.split(' / ').map((x) => x.trim().toLowerCase()).slice(1).includes(size) ||
          (!v.title.includes(' / ') && v.title.toLowerCase() === size))
        .map((v) => v.title.split(' / ')[0].trim())
      lines.push(colours.length
        ? `- ${fam} in stock now in size ${size}, ships right away: ${[...new Set(colours)].join(', ')}.`
        : `- ${fam}: nothing in stock in size ${size} right now.`)
    }
  }
  return lines
}

export async function catalogFacts(text: string): Promise<string> {
  if (!isConfigured()) return ''
  const t = text
  const d = await shopifyGraphQL<{ products: { nodes: CatalogProduct[] } }>(
    `query { products(first: 100, query: "status:active OR status:unlisted") { nodes { title status variants(first: 50) { nodes { id title availableForSale inventoryPolicy inventoryQuantity } } } } }`,
    {},
  )
  const named = namedProducts(d.products.nodes, t)
  if (!named.length) return ''
  const ours = await db.productVariant.findMany({
    where: { shopifyVariantId: { in: named.flatMap((p) => p.variants.nodes.map((v) => v.id.split('/').pop()!)) } },
    select: { id: true, productId: true, shopifyVariantId: true },
  })
  const more = await restockDates(ours)
  const sizes = sizesIn(text)
  const now = sizes.length ? inStockInSize(named, sizes) : []
  return [...now, ...named.map((p) => {
    const onSite = p.status === 'ACTIVE'
    const sizes = p.variants.nodes.map((v) => {
      const inStock = (v.inventoryQuantity ?? 0) > 0
      const state = saleState(onSite, v)
      const mine = ours.find((o) => o.shopifyVariantId === v.id.split('/').pop())
      const dates = !inStock && mine ? more(mine) : []
      return `${v.title}: ${state}${inStock ? '' : dates.length ? ` (more coming: ${dates.join('; ')})` : ' (no restock date on file)'}`
    })
    return `- ${p.title}${onSite ? '' : ' — not on the website right now'}: ${sizes.join('; ')}.`
  })].join('\n')
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

/**
 * Look the order up again before a redraft, when the case has none or has
 * one it cannot treat as the customer's. The lookup used to run only when an
 * email arrived, so a case filed before a fix stayed wrong for good: on
 * 25 Sept 2026 Corinne's two cases kept saying "No Shopify order under ... or
 * #2421" after #2421 could be found, and every redraft asked her for it.
 */
export async function refreshOrder(caseId: string): Promise<void> {
  const c = await db.supportCase.findUnique({
    where: { id: caseId },
    include: { messages: { where: { direction: 'INBOUND' }, select: { body: true } } },
  })
  if (!c) return
  const snap = c.orderSnapshot as OrderSnapshot | null
  if (c.shopifyOrderId && !(snap?.emailMismatch && !snap.sameName)) return
  const quoted = orderNumbersIn([c.subject ?? '', ...c.messages.map((m) => trimQuoted(m.body).text)].join('\n'))
  const lookup = await findOrder(c.customerEmail, quoted, c.customerName)
  if (!lookup.order) return
  await db.$transaction([
    db.supportCase.update({
      where: { id: caseId },
      data: { shopifyOrderName: lookup.order.name, shopifyOrderId: lookup.order.id, orderSnapshot: lookup.order as unknown as Prisma.InputJsonValue },
    }),
    // The "no order" note is now untrue, and a note that is wrong gets believed.
    db.supportMessage.deleteMany({ where: { caseId, direction: 'NOTE', fromAddress: null, body: { startsWith: 'No Shopify order under' } } }),
    db.supportMessage.deleteMany({ where: { caseId, direction: 'NOTE', fromAddress: null, body: { contains: ', the address writing in. Shown so you can judge' } } }),
  ])
  if (lookup.note) await db.supportMessage.create({ data: { caseId, direction: 'NOTE', body: lookup.note } })
}
