import Anthropic from '@anthropic-ai/sdk'
import { db } from '@/lib/db'
import { Prisma } from '@/generated/prisma/client'
import { BACKGROUND_MODEL, CHAT_MODEL } from '@/lib/mouse/agent'
import { recordUsage, usageOf } from '@/lib/mouse/usage'
import { findOrder, variantSiblings, type OrderSnapshot } from '@/lib/support/orders'
import { isConfigured, shopifyGraphQL } from '@/lib/integrations/shopify'
import { addressChangeProblems, discountFacts, DRAFT_INSTRUCTIONS, mentionsDiscount, orderFacts, parseDraft, pickInvoiceProduct, pickSwapLine, pickTargetVariant, teamInstructions, type DraftInvoiceAsk, type DraftSwap, type DraftVariant } from '@/lib/support/reply'
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
    include: { messages: { orderBy: { createdAt: 'desc' }, take: 40 } },
  })
  if (!c || c.category === 'SPAM' || c.status === 'RESOLVED') return
  c.messages.reverse()

  const order = (c.orderSnapshot as OrderSnapshot | null) ?? null
  const told = teamInstructions(c.messages)
  const thread = c.messages
    .filter((m) => m.direction !== 'NOTE')
    .slice(-12)
    .map((m) => `${m.direction === 'INBOUND' ? 'CUSTOMER' : 'US'} (${m.createdAt.toISOString().slice(0, 10)}):\n${trimQuoted(m.body).text.slice(0, 2500)}`)
    .join('\n---\n')

  const latest = c.messages.filter((m) => m.direction === 'INBOUND').slice(-3).map((m) => trimQuoted(m.body).text).join('\n')
  const [stock, catalog, examples, discount] = await Promise.all([
    stockFacts(order).catch(() => ''),
    catalogFacts(catalogText(c.subject, latest, order)).catch((e) => { console.error('[support] catalog facts', e); return '' }),
    recentReplies(caseId).catch(() => ''),
    discountHistory(c.customerEmail).catch((e) => { console.error('[support] discount facts', e); return '' }),
  ])
  // Asked up to twice: a reply that cannot be read as a draft is asked for
  // again once, then left as a note on the case, never silently dropped.
  let d: ReturnType<typeof parseDraft> = null
  let raw = ''
  let outOfCredit = false
  for (let attempt = 0; attempt < 2 && !d && !outOfCredit; attempt++) {
    // Sonnet first. The second try, after an unreadable reply or a safety
    // decline on the customer's words, goes to Opus.
    const model = attempt === 0 ? BACKGROUND_MODEL : CHAT_MODEL
    try {
      const startedAt = Date.now()
      const res = await new Anthropic().messages.create({
        model,
        // Room for thinking, which counts toward the limit.
        max_tokens: 3000,
        system: DRAFT_INSTRUCTIONS,
        output_config: { effort: 'low' },
        messages: [{
          role: 'user',
          content:
            `Today is ${new Date().toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: 'long', day: 'numeric' })}.\n` +
            `Customer: ${c.customerName ?? 'name unknown'} <${c.customerEmail}>. Sorted as: ${c.category}.\n\n` +
            `ORDER FACTS (from Shopify, checked by code):\n${orderFacts(order)}\n\n` +
            (stock ? `STOCK FACTS for items not yet shipped (from our records):\n${stock}\n\n` : '') +
            (catalog ? `CATALOG FACTS for products the customer names or has on their order (from the shop, just now):\n${catalog}\n\n` : '') +
            (discount ? `DISCOUNT FACTS (checked by code):\n${discount}\n\n` : '') +
            (examples ? `${examples}\n\n` : '') +
            `<conversation>\n${thread.slice(-9000)}\n</conversation>\n\n` +
            (told.length ? `TEAM INSTRUCTIONS (typed into the app by the team, newest last; follow them):\n${told.map((t) => `- ${t.slice(0, 600)}`).join('\n')}\n\n` : '') +
            `Draft the reply to the customer's latest email.`,
        }],
      })
      await recordUsage('support-draft', [usageOf(model, res.usage, startedAt)])
      raw = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('')
    } catch (e) {
      console.error('[support] draft failed', caseId, e)
      raw = ''
      const { isOutOfCredit } = await import('@/lib/mouse/credit')
      outOfCredit = isOutOfCredit(e instanceof Error ? e.message : String(e))
    }
    d = parseDraft(raw)
  }
  if (!d && outOfCredit) {
    // Not the draft's fault: say what is actually wrong (6 Oct 2026).
    const { warnOutOfCredit, OUT_OF_CREDIT_LOG } = await import('@/lib/mouse/credit')
    await warnOutOfCredit('drafting a support reply')
    const { logIssues } = await import('@/lib/mouse/issues')
    await logIssues('support-draft', null, [{ kind: 'TURN_UNFINISHED', detail: OUT_OF_CREDIT_LOG }])
    const body = "Mouse couldn't draft this one: the Anthropic account it runs on is out of credit. Once it is topped up, tap \"Draft a reply\", or write it yourself."
    const said = await db.supportMessage.findFirst({ where: { caseId, direction: 'NOTE', body }, select: { id: true } })
    if (!said) await db.supportMessage.create({ data: { caseId, direction: 'NOTE', body } })
    return
  }
  if (!d) {
    const body = "Mouse couldn't write a draft for this one. Tap \"Draft a reply\" to try again, or write it yourself."
    const said = await db.supportMessage.findFirst({ where: { caseId, direction: 'NOTE', body }, select: { id: true } })
    if (!said) await db.supportMessage.create({ data: { caseId, direction: 'NOTE', body } })
    console.error('[support] draft unreadable', caseId, raw.slice(0, 300))
    return
  }
  // Offered anyway despite the facts: say so on the card, where the person
  // tapping Send reads it, rather than trusting the policy alone.
  if (discount && d.reply && mentionsDiscount(d.reply)) {
    d.needs = `Take CLEOFRIEND out: ${discount.split('\n')[0].replace(/ (It works once per customer, so do not offer it|Do not offer it again)\.$/, '')}`.slice(0, 200)
  }
  // The checks are run and stored now so the card can show them, and run
  // again against a fresh read of the order at the moment someone taps.
  const address = d.newAddress
    ? { to: d.newAddress, from: order?.shipTo ?? null, problems: addressChangeProblems(order, c.customerEmail, d.newAddress) }
    : null
  const swap = d.newVariant ? await resolveSwap(order, d.newVariant).catch((e): DraftSwap => ({
    item: d!.newVariant!.item ?? 'item', from: d!.newVariant!.from ?? '', to: d!.newVariant!.to, quantity: 0,
    lineItemId: null, fromVariantId: null, toVariantId: null,
    problems: [`Could not read the product from Shopify: ${e instanceof Error ? e.message.slice(0, 120) : String(e)}`],
  })) : null
  // An invoice only when the team asked for one: a customer's email can make
  // the drafter mention one, never put one on the card.
  const askedForInvoice = told.some((t) => /\b(invoice|charge|bill)\b/i.test(t))
  const invoice = d.newInvoice && askedForInvoice
    ? await resolveInvoice(c, order, d.newInvoice).catch((e): DraftInvoice => ({
      item: d!.newInvoice!.item, variant: d!.newInvoice!.variant ?? '', quantity: d!.newInvoice!.quantity, shopifyVariantId: null,
      email: c.customerEmail, name: null, unitPrice: null, problems: [`Could not read the product from Shopify: ${e instanceof Error ? e.message.slice(0, 120) : String(e)}`],
    }))
    : null
  await db.supportCase.update({
    where: { id: caseId },
    data: {
      draftReply: d.reply,
      draftNeeds: d.needs,
      draftAddress: address ? (address as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
      draftSwap: swap ? (swap as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
      draftInvoice: invoice ? (invoice as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
      draftedAt: new Date(),
    },
  })
}

/**
 * An invoice the team asked for on a case, set up for one tap: the shop
 * product and variant, the name and email it goes to, and Shopify's own price
 * (money is worked out by Shopify, never by Mouse). Stored with its problems
 * so the card can show them; the tap checks again before anything is sent.
 */
export type DraftInvoice = {
  item: string; variant: string; quantity: number; shopifyVariantId: string | null
  email: string; name: string | null; unitPrice: number | null; problems: string[]
}

export async function resolveInvoice(
  c: { customerEmail: string; customerName: string | null },
  order: OrderSnapshot | null,
  want: DraftInvoiceAsk,
): Promise<DraftInvoice> {
  const theirs = order && !(order.emailMismatch && !order.sameName)
  const name = c.customerName?.trim() || (theirs ? order!.shipTo?.name?.trim() || order!.billName?.trim() : null) || null
  const base: DraftInvoice = { item: want.item, variant: want.variant ?? '', quantity: want.quantity, shopifyVariantId: null, email: c.customerEmail, name, unitPrice: null, problems: [] }
  if (/@(send\.)?cleocamp\.com$/i.test(c.customerEmail)) base.problems.push('This case is filed under our own address, so there is no customer to invoice.')
  if (!name) base.problems.push('There is no name for this customer on the case or the order. Invoice from the main Mouse chat, giving her name.')
  if (!isConfigured()) return { ...base, problems: [...base.problems, 'Shopify is not connected.'] }
  const d = await shopifyGraphQL<{ products: { nodes: CatalogProduct[] } }>(
    `query { products(first: 100, query: "status:active OR status:unlisted") { nodes { title status variants(first: 50) { nodes { id title availableForSale inventoryPolicy inventoryQuantity } } } } }`,
    {},
  )
  const p = pickInvoiceProduct(d.products.nodes, want.item, (theirs ? order!.items : []).map((i) => i.title))
  if (!p.ok) return { ...base, problems: [...base.problems, p.problem] }
  const vs = p.product.variants.nodes
  const v = vs.length === 1 && !want.variant
    ? { ok: true as const, id: vs[0].id, title: vs[0].title }
    : pickTargetVariant(vs, want.variant ?? '', null)
  if (!v.ok) return { ...base, item: p.product.title, problems: [...base.problems, v.problem] }
  const found = { ...base, item: p.product.title, variant: v.title, shopifyVariantId: v.id }
  const sv = vs.find((x) => x.id === v.id)!
  if (!sv.availableForSale) found.problems.push(`${p.product.title} ${v.title} cannot be bought on the site right now.`)
  else if ((sv.inventoryQuantity ?? 0) < want.quantity && sv.inventoryPolicy !== 'CONTINUE') found.problems.push(`Shopify shows ${sv.inventoryQuantity ?? 0} of ${p.product.title} ${v.title} in stock.`)
  const { quoteLiveSale } = await import('@/lib/live-sale')
  const q = await quoteLiveSale(c.customerEmail, [{ shopifyVariantId: v.id, label: `${p.product.title} / ${v.title}`, quantity: want.quantity, priceOverride: null }]).catch(() => null)
  return { ...found, unitPrice: q?.lines[0]?.unitPrice ?? null, ...(q ? {} : { problems: [...found.problems, 'Shopify could not price it.'] }) }
}

/**
 * The swap the drafter named, found on the order and in the product by code.
 * Stored with its problems so the card can show them; checked again on a
 * fresh read of the order at the tap. Same ownership rule as a cancel: the
 * order's own email, or the name on it matching the person writing in.
 */
export async function resolveSwap(order: OrderSnapshot | null, want: DraftVariant): Promise<DraftSwap> {
  const base: DraftSwap = { item: want.item ?? 'item', from: want.from ?? '', to: want.to, quantity: 0, lineItemId: null, fromVariantId: null, toVariantId: null, problems: [] }
  if (order?.emailMismatch && !order.sameName) base.problems.push(`This order was placed with ${order.emailMismatch} under another name.`)
  const l = pickSwapLine(order, want)
  if (!l.ok) return { ...base, problems: [...base.problems, l.problem] }
  const line = { ...base, item: l.line.title, from: l.line.variant ?? '', quantity: l.line.quantity, lineItemId: l.line.id, fromVariantId: l.line.variantId }
  if (!l.line.variantId) return { ...line, problems: [...line.problems, 'That item has no product in Shopify any more.'] }
  const t = pickTargetVariant(await variantSiblings(l.line.variantId), want.to, l.line.variantId)
  return t.ok ? { ...line, to: t.title, toVariantId: t.id } : { ...line, problems: [...line.problems, t.problem] }
}

/**
 * CLEOFRIEND and this customer: our sent replies to them that offered it (any
 * case), and their Shopify orders that used it. Empty when neither.
 */
export async function discountHistory(email: string): Promise<string> {
  const offered = await db.supportMessage.findMany({
    where: { direction: 'OUTBOUND', body: { contains: 'CLEOFRIEND', mode: 'insensitive' }, case: { customerEmail: { equals: email, mode: 'insensitive' } } },
    orderBy: { createdAt: 'asc' }, select: { createdAt: true },
  })
  let used: string[] = []
  if (isConfigured()) {
    const q = `email:${JSON.stringify(email)} AND discount_code:CLEOFRIEND`
    const d = await shopifyGraphQL<{ orders: { nodes: Array<{ name: string }> } }>(
      `query($q: String!) { orders(first: 5, query: $q) { nodes { name } } }`, { q },
    ).catch(() => null)
    used = d?.orders.nodes.map((o) => o.name) ?? []
  }
  return discountFacts(offered.map((m) => m.createdAt), used)
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
 * When more of a variant is expected: open production runs and open POs with
 * a line for that exact variant. A fabric or label PO tagged to the same
 * product (RichLine, L&L) says nothing about when a tee reaches a customer,
 * so it is not counted.
 *
 * Runs used to count for every variant of their product. On 25 Sept 2026 the
 * Cleo Tee run at the dye house, which has no colours recorded, lent its
 * 7 October date to Ruby Red, and JJ was told red was coming then. PO 2360,
 * the batch actually due that day, has no red on it. A run with no lines says
 * nothing about which colours it carries, so it now dates nothing.
 */
async function restockDates(variants: Array<{ id: string; productId: string }>): Promise<(v: { id: string; productId: string }) => string[]> {
  const productIds = [...new Set(variants.map((v) => v.productId))]
  const [pos, runs] = await Promise.all([
    db.purchaseOrder.findMany({
      where: { status: { in: ['SENT', 'PARTIALLY_RECEIVED'] }, lines: { some: { productVariantId: { in: variants.map((v) => v.id) } } } },
      select: { poNumber: true, expectedAt: true, lines: { select: { productVariantId: true } } },
    }),
    db.productionRun.findMany({
      where: { productId: { in: productIds }, status: { notIn: ['RECEIVED', 'CANCELLED'] }, lines: { some: { productVariantId: { in: variants.map((v) => v.id) } } } },
      select: { productId: true, expectedReadyAt: true, dateConfirmed: true, status: true, lines: { select: { productVariantId: true } } },
    }),
  ])
  const day = (d: Date) => d.toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: 'long', day: 'numeric' })
  return (v) => [
    ...runs.filter((r) => r.expectedReadyAt && r.lines.some((l) => l.productVariantId === v.id))
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
/**
 * The text catalog facts are looked up from: the subject, the customer's
 * latest words, and the products on their order, shipped or not. Brandon,
 * 6 Oct 2026, on #2614: a Small Boy Belt, delivered, being exchanged for a
 * Medium. Her email said "the belt" and "the new size", never "Boy Belt", and
 * stock facts only cover unshipped items, so the Medium was never looked up
 * and the draft asked the team to confirm it was in stock: "Mouse should
 * confirm if this is in stock, not us." An order that is not the sender's
 * (another address, a different name) adds nothing, the same rule
 * stockFacts follows. Pure.
 */
export function catalogText(subject: string | null | undefined, latest: string, order: OrderSnapshot | null): string {
  const theirs = order && !(order.emailMismatch && !order.sameName)
  const ordered = theirs ? [...new Set(order.items.map((i) => i.title).filter(Boolean))] : []
  return [subject ?? '', latest, ...ordered].join('\n')
}

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
