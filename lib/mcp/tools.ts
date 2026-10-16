import { TZDate } from '@date-fns/tz'
import { z } from 'zod'
import type { Prisma } from '@/generated/prisma/client'
import type { LiveStock } from '@/lib/mcp/live-stock'
import { poAmounts, poLineLabel } from '@/lib/po'
import { nextStyleNumber } from '@/lib/style-system'

/**
 * The Claude connector's tools (16 Oct 2026). Read-only: each one gets a
 * transaction the route has already set READ ONLY, so Postgres itself refuses
 * any write, and none of them calls Shopify, QuickBooks, Resend or a model.
 * Answers are compact JSON; money is in dollars; anything that can grow is
 * paged. Every answer goes through lib/mcp/scrub.ts on the way out.
 *
 * Never selected here: a vendor's email, cc list, contact, address, payment
 * notes or free-text notes; anything about customers.
 */

export type Tx = Prisma.TransactionClient

export class ToolError extends Error {
  constructor(public kind: 'not_found' | 'invalid_input', message: string) { super(message) }
}

/**
 * Who is asking, and how to reach Shopify for live stock. Claude (claude.ai,
 * through OAuth) gets every tool; Muse (its own key) gets the ones that hold
 * nothing about customers, stores or the team's opinions (MUSE_TOOLS).
 */
export type ToolContext = {
  audience: 'claude' | 'muse'
  liveStock?: LiveStock
  /** Who approved the connection (a personal sign-in), or null for the shared password or Muse. */
  personId?: string | null
  /** Mouse's chat turn, for tell_mouse (lib/mcp/tell.ts); injected in tests. */
  runMouse?: import('@/lib/mcp/tell').MouseRunner
}

export type McpTool<S extends z.ZodRawShape = z.ZodRawShape> = {
  name: string
  title: string
  description: string
  input: S
  /**
   * Only the two tell tools (lib/mcp/tell.ts). Every other tool runs in a
   * READ ONLY transaction; these run on the plain client, because they write.
   */
  writes?: boolean
  run: (tx: Tx, input: z.infer<z.ZodObject<S>>, ctx: ToolContext) => Promise<unknown>
}

export const tool = <S extends z.ZodRawShape>(t: McpTool<S>) => t

const usd = (cents: number | null | undefined) => (cents == null ? null : Math.round(cents) / 100)
// Calendar dates (due, ordered, expected, the brief's day) are stored at UTC
// midnight of the day meant and shown in UTC everywhere in the app.
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null)
// When something happened (a note written, a PO made): the Los Angeles date.
const laDate = (d: Date | null | undefined) => (d ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(d) : null)
/** Start of an LA calendar day, or the start of the next one, as an instant. */
const laStart = (ymd: string, plusDays = 0) => {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(new TZDate(y, m - 1, d + plusDays, 'America/Los_Angeles').getTime())
}
const qty = (d: unknown) => (d == null ? null : Number(d))
const page = (p: number | undefined) => Math.max(1, Math.trunc(p ?? 1))
const paged = <T>(items: T[], total: number, p: number, size: number) => ({ page: p, pageSize: size, total, hasMore: p * size < total, items })

// ---- what a note or a to-do is about ----

type Ref = { entityType: string; entityId: string | null }
/** Names for the records a set of notes or to-dos point at, in one query per kind. */
async function namesFor(tx: Tx, refs: Ref[]): Promise<(r: Ref) => { type: string; name: string | null }> {
  const ids = (t: string) => [...new Set(refs.filter((r) => r.entityType === t && r.entityId).map((r) => r.entityId!))]
  const [products, variants, components, vendors, pos, runs] = await Promise.all([
    ids('PRODUCT').length ? tx.product.findMany({ where: { id: { in: ids('PRODUCT') } }, select: { id: true, name: true } }) : [],
    ids('PRODUCT_VARIANT').length ? tx.productVariant.findMany({ where: { id: { in: ids('PRODUCT_VARIANT') } }, select: { id: true, size: true, product: { select: { name: true } }, colorway: { select: { customerName: true } } } }) : [],
    ids('COMPONENT').length ? tx.component.findMany({ where: { id: { in: ids('COMPONENT') } }, select: { id: true, name: true } }) : [],
    ids('VENDOR').length ? tx.vendor.findMany({ where: { id: { in: ids('VENDOR') } }, select: { id: true, name: true } }) : [],
    ids('PURCHASE_ORDER').length ? tx.purchaseOrder.findMany({ where: { id: { in: ids('PURCHASE_ORDER') } }, select: { id: true, poNumber: true } }) : [],
    ids('PRODUCTION_RUN').length ? tx.productionRun.findMany({ where: { id: { in: ids('PRODUCTION_RUN') } }, select: { id: true, product: { select: { name: true } } } }) : [],
  ])
  const m = new Map<string, string>([
    ...products.map((p) => [p.id, p.name] as const),
    ...variants.map((v) => [v.id, [v.product.name, v.colorway?.customerName, v.size].filter(Boolean).join(' / ')] as const),
    ...components.map((c) => [c.id, c.name] as const),
    ...vendors.map((v) => [v.id, v.name] as const),
    ...pos.map((p) => [p.id, `PO ${p.poNumber}`] as const),
    ...runs.map((r) => [r.id, `production run: ${r.product.name}`] as const),
  ])
  const TYPE: Record<string, string> = { PRODUCT: 'product', PRODUCT_VARIANT: 'variant', COMPONENT: 'component', VENDOR: 'vendor', PURCHASE_ORDER: 'purchase order', PRODUCTION_RUN: 'production run', CHAT_MESSAGE: 'chat', GENERAL: 'general' }
  return (r) => ({ type: TYPE[r.entityType] ?? r.entityType.toLowerCase(), name: r.entityId ? m.get(r.entityId) ?? null : null })
}

// ---- products ----

const productSelect = {
  id: true, name: true, status: true, retailPriceCents: true, wholesalePriceCents: true, productionLeadTimeDays: true,
  style: { select: { number: true, categoryCode: true, status: true } },
  colorways: { where: { active: true }, orderBy: { customerName: 'asc' }, select: { customerName: true, colorCode: true } },
  variants: {
    orderBy: [{ colorway: { customerName: 'asc' } }, { size: 'asc' }],
    select: { id: true, size: true, sku: true, newSku: true, shopifySku: true, shopifyVariantId: true, onHandQty: true, retailPriceCents: true, wholesalePriceCents: true, colorway: { select: { customerName: true } } },
  },
} satisfies Prisma.ProductSelect

type ProductRow = Prisma.ProductGetPayload<{ select: typeof productSelect }>

type Live = Map<string, number> | null

/**
 * Shopify's count right now for every variant in these products, or null if
 * Shopify could not be asked (not set up, an error, too slow). Never throws:
 * the answer then carries the app's copy and says so.
 */
async function liveFor(rows: ProductRow[], ctx: ToolContext) {
  const ids = rows.flatMap((p) => p.variants.map((v) => v.shopifyVariantId).filter((id): id is string => !!id))
  if (!ctx.liveStock) return { live: null as Live, stock: { source: "the app's copy of Shopify (live stock not available here)" } }
  try {
    const live = await ctx.liveStock(ids)
    return { live: live as Live, stock: { source: 'Shopify, live', asOf: new Date().toISOString() } }
  } catch {
    return { live: null as Live, stock: { source: "the app's copy of Shopify: Shopify did not answer just now" } }
  }
}

/** A variant's stock: Shopify's live number when there is one, else the app's copy, saying which. */
function onHandOf(v: ProductRow['variants'][number], live: Live) {
  if (live && v.shopifyVariantId && live.has(v.shopifyVariantId)) return { onHand: live.get(v.shopifyVariantId)!, from: 'shopify' as const }
  // Null is unknown, never zero (CLAUDE.md §3).
  return { onHand: qty(v.onHandQty), from: 'app' as const }
}

function variantOut(p: ProductRow, v: ProductRow['variants'][number], live: Live) {
  const s = onHandOf(v, live)
  return {
    colorway: v.colorway?.customerName ?? null,
    size: v.size,
    newSku: v.newSku,
    oldSku: v.sku,
    shopifySku: v.shopifySku,
    onHand: s.onHand,
    // Only said when it is not Shopify's live count: a variant not on
    // Shopify (a wholesale-only colour), or Shopify not answering.
    ...(live && s.from === 'app' ? { stockFrom: v.shopifyVariantId ? "app's copy" : 'app (not on Shopify)' } : {}),
    wholesale: usd(v.wholesalePriceCents ?? p.wholesalePriceCents),
    retail: usd(v.retailPriceCents ?? p.retailPriceCents),
  }
}

function productOut(p: ProductRow, live: Live) {
  const known = p.variants.map((v) => onHandOf(v, live).onHand).filter((n): n is number => n != null)
  return {
    name: p.name,
    styleNumber: p.style?.number ?? null,
    category: p.style?.categoryCode ?? null,
    status: p.status,
    wholesale: usd(p.wholesalePriceCents),
    retail: usd(p.retailPriceCents),
    colorways: p.colorways.map((c) => c.customerName),
    sizes: [...new Set(p.variants.map((v) => v.size).filter((s): s is string => !!s))],
    onHandTotal: known.length ? known.reduce((a, b) => a + b, 0) : null,
    onHandUnknownVariants: p.variants.length - known.length,
    variants: p.variants.map((v) => variantOut(p, v, live)),
  }
}

const STATUS = z.enum(['DEVELOPMENT', 'SAMPLING', 'ACTIVE', 'SUNSETTED'])

export const listProducts = tool({
  name: 'list_products',
  title: 'List products',
  description:
    'Every product in Studio Mouse with its style number, category, status, colourways, sizes and, per variant, the new style-system SKU, ' +
    'the old SKU, the SKU Shopify holds, on-hand stock (Shopify\'s live count; "stock" says if it fell back to the app\'s copy; null means ' +
    'unknown, not zero) and wholesale and retail ' +
    'prices in USD. Use for questions across the range ("what is in stock", "which products are active", "what does the Cleo Tee cost wholesale"). ' +
    'Filter by status, style category code (e.g. "TP") or style number. For one product with its BOM and notes, use get_product.',
  input: {
    status: STATUS.optional().describe('Only products with this status'),
    category: z.string().max(10).optional().describe('Style category code, e.g. "TP"'),
    styleNumber: z.string().max(20).optional().describe('Exact style number, e.g. "TP101"'),
  },
  run: async (tx, i, ctx) => {
    const rows = await tx.product.findMany({
      where: {
        ...(i.status ? { status: i.status } : {}),
        ...(i.category || i.styleNumber ? { style: { ...(i.category ? { categoryCode: i.category.toUpperCase() } : {}), ...(i.styleNumber ? { number: i.styleNumber.toUpperCase() } : {}) } } : {}),
      },
      orderBy: { name: 'asc' },
      select: productSelect,
    })
    const { live, stock } = await liveFor(rows, ctx)
    return { count: rows.length, stock, products: rows.map((p) => productOut(p, live)) }
  },
})

export const getProduct = tool({
  name: 'get_product',
  title: 'Get one product',
  description:
    'One product in full, found by style number ("TP101"), any SKU (new, old or Shopify\'s) or name: its variants with stock and prices, ' +
    'its bill of materials (each component, how much per unit, which sizes or colours it applies to, its supplier and cost) and the notes ' +
    'kept about it. Stock is Shopify\'s live count. If the name matches more than one product, the matches come back to choose from.',
  input: { query: z.string().min(1).max(120).describe('Style number, SKU or product name') },
  run: async (tx, i, ctx) => {
    const q = i.query.trim()
    const byStyle = await tx.product.findMany({ where: { style: { number: { equals: q, mode: 'insensitive' } } }, select: { id: true, name: true } })
    const bySku = byStyle.length ? [] : await tx.product.findMany({
      where: { variants: { some: { OR: [{ newSku: { equals: q, mode: 'insensitive' } }, { sku: { equals: q, mode: 'insensitive' } }, { shopifySku: { equals: q, mode: 'insensitive' } }] } } },
      select: { id: true, name: true },
    })
    const byName = byStyle.length || bySku.length ? [] : await tx.product.findMany({ where: { name: { equals: q, mode: 'insensitive' } }, select: { id: true, name: true } })
    const loose = byStyle.length || bySku.length || byName.length ? [] : await tx.product.findMany({ where: { name: { contains: q, mode: 'insensitive' } }, select: { id: true, name: true, style: { select: { number: true } } }, take: 20 })
    const hits = byStyle.length ? byStyle : bySku.length ? bySku : byName.length ? byName : loose
    if (!hits.length) throw new ToolError('not_found', `No product matches "${q}". Try list_products.`)
    if (hits.length > 1) {
      const named = await tx.product.findMany({ where: { id: { in: hits.map((h) => h.id) } }, select: { name: true, style: { select: { number: true } } }, orderBy: { name: 'asc' } })
      return { ambiguous: true, matches: named.map((p) => ({ name: p.name, styleNumber: p.style?.number ?? null })) }
    }
    const id = hits[0].id
    const [p, bom, notes] = await Promise.all([
      tx.product.findUniqueOrThrow({ where: { id }, select: productSelect }),
      tx.bomLine.findMany({
        where: { parentProductId: id },
        orderBy: { component: { name: 'asc' } },
        select: { qtyPerUnit: true, size: true, colorway: true, notes: true, component: { select: { name: true, category: true, unitOfMeasure: true, unitCostCents: true, leadTimeDays: true, vendor: { select: { name: true } } } } },
      }),
      // The team's notes stay inside the company: Muse never gets them (CLAUDE.md §4).
      ctx.audience === 'muse' ? [] : tx.note.findMany({ where: { entityType: 'PRODUCT', entityId: id, supersededAt: null }, orderBy: { createdAt: 'desc' }, take: 30, select: { content: true, createdAt: true } }),
    ])
    const { live, stock } = await liveFor([p], ctx)
    return {
      ...productOut(p, live),
      stock,
      productionLeadTimeDays: p.productionLeadTimeDays,
      bom: bom.map((b) => ({
        component: b.component.name, category: b.component.category, qtyPerUnit: qty(b.qtyPerUnit), unit: b.component.unitOfMeasure,
        onlyFor: [b.colorway, b.size ? `size ${b.size}` : null].filter(Boolean).join(', ') || null,
        supplier: b.component.vendor?.name ?? null, unitCost: usd(b.component.unitCostCents), leadTimeDays: b.component.leadTimeDays,
      })),
      ...(ctx.audience === 'muse' ? {} : { notes: notes.map((n) => ({ date: laDate(n.createdAt), text: n.content })) }),
    }
  },
})

export const wholesalePriceList = tool({
  name: 'wholesale_price_list',
  title: 'Wholesale price list',
  description:
    'The wholesale price list exactly as the Wholesale page shows it: every active product that has a retail price, its wholesale and retail ' +
    'price in USD, and wholesale as a percentage of retail (the figure the page shows beside each price). Products priced by colour or size ' +
    'list each variant\'s own price. A wholesale price that is not set is flagged "not set". Use for any wholesale pricing question.',
  input: {},
  run: async (tx) => {
    // The same query as app/(main)/wholesale/page.tsx, and the same arithmetic.
    const products = await tx.product.findMany({
      where: { status: 'ACTIVE', retailPriceCents: { not: null } },
      orderBy: { name: 'asc' },
      select: {
        name: true, retailPriceCents: true, wholesalePriceCents: true, style: { select: { number: true } },
        variants: {
          orderBy: [{ colorway: { customerName: 'asc' } }, { size: 'asc' }],
          select: { size: true, retailPriceCents: true, wholesalePriceCents: true, colorway: { select: { customerName: true } } },
        },
      },
    })
    const pct = (w: number | null, r: number | null) => (w != null && r ? Math.round((w / r) * 100) : null)
    let notSet = 0
    const rows = products.map((p) => {
      const byVariant = p.wholesalePriceCents == null && p.variants.some((v) => v.wholesalePriceCents != null)
      const own = p.variants.filter((v) => byVariant || (v.wholesalePriceCents != null && v.wholesalePriceCents !== p.wholesalePriceCents))
      if (!byVariant && p.wholesalePriceCents == null) notSet++
      return {
        name: p.name,
        styleNumber: p.style?.number ?? null,
        wholesale: byVariant ? 'by colour & size' : p.wholesalePriceCents == null ? 'not set' : usd(p.wholesalePriceCents),
        retail: usd(p.retailPriceCents),
        wholesalePctOfRetail: byVariant ? null : pct(p.wholesalePriceCents, p.retailPriceCents),
        ...(own.length ? {
          variants: own.map((v) => {
            const retail = v.retailPriceCents ?? p.retailPriceCents
            if (v.wholesalePriceCents == null) notSet++
            return {
              variant: [v.colorway?.customerName, v.size].filter(Boolean).join(' / ') || 'One size',
              wholesale: v.wholesalePriceCents == null ? 'not set' : usd(v.wholesalePriceCents),
              retail: usd(retail),
              wholesalePctOfRetail: pct(v.wholesalePriceCents, retail),
            }
          }),
        } : {}),
      }
    })
    return { products: rows.length, notSet, rows, terms: 'Shipped orders add $25 shipping & handling, waived over $2,500 (as the Wholesale page says).' }
  },
})

// ---- purchase orders ----

const PO_STATUS = z.enum(['DRAFT', 'SENT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'])
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD')

export const listPurchaseOrders = tool({
  name: 'list_purchase_orders',
  title: 'List purchase orders',
  description:
    'Purchase orders, newest first, 25 to a page: number, vendor, status, ordered / expected / received dates, currency and total (the sum of ' +
    'priced lines; "incomplete" when a line has no price). Filter by status, vendor name (any part of it) and a date range on the order date ' +
    '(or the date it was made, for a draft). Use get_purchase_order for the lines.',
  input: {
    status: PO_STATUS.optional(),
    vendor: z.string().max(80).optional().describe('Any part of the vendor name'),
    from: DATE.optional().describe('Ordered (or made) on or after, YYYY-MM-DD'),
    to: DATE.optional().describe('Ordered (or made) on or before, YYYY-MM-DD'),
    page: z.number().int().min(1).max(1000).optional(),
  },
  run: async (tx, i) => {
    const p = page(i.page), size = 25
    // The order date is a calendar date (UTC midnight); a draft's is when it was made, in LA.
    const ordered = { ...(i.from ? { gte: new Date(`${i.from}T00:00:00Z`) } : {}), ...(i.to ? { lte: new Date(`${i.to}T00:00:00Z`) } : {}) }
    const made = { ...(i.from ? { gte: laStart(i.from) } : {}), ...(i.to ? { lt: laStart(i.to, 1) } : {}) }
    const where: Prisma.PurchaseOrderWhereInput = {
      ...(i.status ? { status: i.status } : {}),
      ...(i.vendor ? { vendor: { name: { contains: i.vendor, mode: 'insensitive' } } } : {}),
      ...(i.from || i.to ? { OR: [{ orderedAt: ordered }, { orderedAt: null, createdAt: made }] } : {}),
    }
    const [total, rows] = await Promise.all([
      tx.purchaseOrder.count({ where }),
      tx.purchaseOrder.findMany({
        where, orderBy: [{ createdAt: 'desc' }], skip: (p - 1) * size, take: size,
        select: { poNumber: true, status: true, orderedAt: true, expectedAt: true, receivedAt: true, currency: true, createdAt: true, vendor: { select: { name: true } }, lines: { select: { qtyOrdered: true, unitCostCents: true } } },
      }),
    ])
    return paged(rows.map((po) => {
      const a = poAmounts(po.lines)
      return {
        poNumber: po.poNumber, vendor: po.vendor.name, status: po.status,
        ordered: day(po.orderedAt), expected: day(po.expectedAt), received: laDate(po.receivedAt), made: laDate(po.createdAt),
        currency: po.currency, total: usd(a.knownCents), totalIncomplete: a.incomplete || undefined, lines: po.lines.length,
      }
    }), total, p, size)
  },
})

export const getPurchaseOrder = tool({
  name: 'get_purchase_order',
  title: 'Get one purchase order',
  description:
    'One purchase order by number ("2403"), with its lines. A line that was sent shows the SKU, style, colour and size saved on the PO at the time ' +
    'it was sent (what the vendor saw), not today\'s; a draft line shows today\'s. Quantities ordered and received, unit, unit cost and amount, ' +
    'in the PO\'s currency.',
  input: { poNumber: z.string().min(1).max(30).describe('PO number, with or without "PO"') },
  run: async (tx, i) => {
    const n = i.poNumber.replace(/^\s*po\s*#?\s*/i, '').trim()
    const po = await tx.purchaseOrder.findUnique({
      where: { poNumber: n },
      select: {
        poNumber: true, status: true, orderedAt: true, expectedAt: true, receivedAt: true, currency: true, notes: true, createdAt: true,
        depositPercent: true, netDaysAfterDelivery: true, depositPaidAt: true,
        vendor: { select: { name: true } }, forProduct: { select: { name: true } },
        lines: {
          orderBy: { id: 'asc' },
          select: {
            qtyOrdered: true, qtyReceived: true, unit: true, unitCostCents: true, description: true,
            snapshotAt: true, snapSku: true, snapStyleNumber: true, snapProductName: true, snapColorway: true, snapSize: true,
            component: true,
            productVariant: { include: { product: { include: { style: { select: { number: true } } } }, colorway: true } },
          },
        },
      },
    })
    if (!po) throw new ToolError('not_found', `No purchase order ${n}.`)
    const a = poAmounts(po.lines)
    return {
      poNumber: po.poNumber, vendor: po.vendor.name, status: po.status, forProduct: po.forProduct?.name ?? null,
      made: laDate(po.createdAt), ordered: day(po.orderedAt), expected: day(po.expectedAt), received: laDate(po.receivedAt),
      currency: po.currency, total: usd(a.knownCents), totalIncomplete: a.incomplete || undefined,
      depositPercent: po.depositPercent, depositPaid: laDate(po.depositPaidAt), netDaysAfterDelivery: po.netDaysAfterDelivery,
      // Printed on the vendor's copy (CLAUDE.md §4): only what someone wrote to them.
      notesToVendor: po.notes,
      lines: po.lines.map((l) => {
        const v = l.productVariant
        const snap = l.snapshotAt != null
        return {
          item: snap && l.snapProductName ? l.snapProductName : poLineLabel(l),
          sku: snap ? l.snapSku : v?.newSku ?? v?.sku ?? l.component?.vendorSku ?? null,
          styleNumber: snap ? l.snapStyleNumber : v?.product.style?.number ?? null,
          colorway: snap ? l.snapColorway : v?.colorway?.customerName ?? null,
          size: snap ? l.snapSize : v?.size ?? null,
          asSent: snap ? laDate(l.snapshotAt) : null,
          ordered: qty(l.qtyOrdered), received: qty(l.qtyReceived), unit: l.unit,
          unitCost: usd(l.unitCostCents), amount: l.unitCostCents == null ? null : usd(Math.round(Number(l.qtyOrdered) * l.unitCostCents)),
        }
      }),
    }
  },
})

// ---- questions, to-dos, notes ----

export const listOpenQuestions = tool({
  name: 'list_open_questions',
  title: 'List open questions and to-dos',
  description:
    'Open questions Studio Mouse is waiting on, to-dos for the team, and gaps (things Mouse could not do), 50 to a page, soonest due first: ' +
    'title, detail, due date, urgent, what it is about (product, vendor, PO...) and where it came from (a question raised from an email is a ' +
    'proposal still to confirm). Filter by kind.',
  input: {
    kind: z.enum(['QUESTION', 'TODO', 'GAP']).optional(),
    page: z.number().int().min(1).max(1000).optional(),
  },
  run: async (tx, i) => {
    const p = page(i.page), size = 50
    const where: Prisma.ActionItemWhereInput = { resolved: false, ...(i.kind ? { kind: i.kind } : {}) }
    const [total, rows] = await Promise.all([
      tx.actionItem.count({ where }),
      tx.actionItem.findMany({
        where, orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }], skip: (p - 1) * size, take: size,
        select: { kind: true, title: true, detail: true, dueDate: true, urgent: true, source: true, createdAt: true, entityType: true, entityId: true, assignedTo: { select: { name: true } } },
      }),
    ])
    const about = await namesFor(tx, rows)
    return paged(rows.map((r) => ({
      kind: r.kind, title: r.title, detail: r.detail ? r.detail.slice(0, 600) : null, due: day(r.dueDate), urgent: r.urgent || undefined,
      about: about(r), from: r.source === 'EMAIL' ? 'email (a proposal to confirm)' : r.source.toLowerCase(), assignedTo: r.assignedTo?.name ?? null, raised: laDate(r.createdAt),
    })), total, p, size)
  },
})

export const searchNotes = tool({
  name: 'search_notes',
  title: 'Search notes',
  description:
    'Search the notes Studio Mouse keeps (facts and decisions the team told it), newest first, 25 to a page: the note, its date, what it is ' +
    'attached to, and whether it is current or superseded by a later note (a superseded note is history, not a fact to act on). Mouse has no ' +
    'separate "unconfirmed" state for notes: unconfirmed proposals are open questions (list_open_questions). Leave query empty for the latest.',
  input: {
    query: z.string().max(120).optional().describe('Words to find, any case'),
    includeSuperseded: z.boolean().optional().describe('Also search notes a later note replaced (default false)'),
    page: z.number().int().min(1).max(1000).optional(),
  },
  run: async (tx, i) => {
    const p = page(i.page), size = 25
    const where: Prisma.NoteWhereInput = {
      ...(i.query?.trim() ? { content: { contains: i.query.trim(), mode: 'insensitive' } } : {}),
      ...(i.includeSuperseded ? {} : { supersededAt: null }),
    }
    const [total, rows] = await Promise.all([
      tx.note.count({ where }),
      tx.note.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (p - 1) * size, take: size, select: { content: true, createdAt: true, supersededAt: true, source: true, entityType: true, entityId: true } }),
    ])
    const about = await namesFor(tx, rows)
    return paged(rows.map((n) => ({
      date: laDate(n.createdAt), text: n.content, about: about(n),
      status: n.supersededAt ? `superseded ${laDate(n.supersededAt)}` : 'current', source: n.source.toLowerCase(),
    })), total, p, size)
  },
})

// ---- the brief, vendors, the style system ----

export const getLatestSnapshot = tool({
  name: 'get_latest_snapshot',
  title: 'Latest daily brief',
  description:
    'The most recent daily brief Studio Mouse wrote for the team: what needs attention today, as composed by the nightly run. Use to catch up ' +
    'on where things stand before digging into specifics.',
  input: {},
  run: async (tx) => {
    const b = await tx.dailyBrief.findFirst({ orderBy: { forDate: 'desc' }, select: { forDate: true, text: true, createdAt: true } })
    if (!b) throw new ToolError('not_found', 'No daily brief has been written yet.')
    return { forDate: day(b.forDate), written: b.createdAt.toISOString(), brief: b.text }
  },
})

export const listVendors = tool({
  name: 'list_vendors',
  title: 'List vendors',
  description:
    'Vendors (suppliers, manufacturers, dye houses): role, whether active, lead time in days, how orders are placed, payment terms, and what ' +
    'they supply (their active components). No contact details, addresses or bank details. Filter by role; inactive vendors only on request.',
  input: {
    role: z.enum(['COMPONENT_SUPPLIER', 'MANUFACTURER', 'DYE_HOUSE', 'OTHER']).optional(),
    includeInactive: z.boolean().optional(),
  },
  run: async (tx, i) => {
    const rows = await tx.vendor.findMany({
      where: { ...(i.role ? { role: i.role } : {}), ...(i.includeInactive ? {} : { active: true }) },
      orderBy: { name: 'asc' },
      // Picked field by field: email, ccEmails, contactName, contactInfo,
      // address and notes are never read.
      select: {
        name: true, legalName: true, role: true, active: true, leadTimeDays: true, orderMethod: true, paymentTerms: true,
        components: { where: { active: true }, orderBy: { name: 'asc' }, select: { name: true, category: true, leadTimeDays: true } },
        _count: { select: { purchaseOrders: true, productionRuns: true } },
      },
    })
    return {
      count: rows.length,
      vendors: rows.map((v) => ({
        name: v.name, legalName: v.legalName, role: v.role, active: v.active, leadTimeDays: v.leadTimeDays,
        orderMethod: v.orderMethod, paymentTerms: v.paymentTerms,
        supplies: v.components.map((c) => ({ component: c.name, category: c.category, leadTimeDays: c.leadTimeDays })),
        purchaseOrders: v._count.purchaseOrders, productionRuns: v._count.productionRuns,
      })),
    }
  },
})

export const styleSystem = tool({
  name: 'style_system',
  title: 'Style system',
  description:
    'The style-number system: style categories with the next free style number in each, colour codes and size codes, each confirmed or ' +
    'proposed. A SKU is STYLE-COLOUR-SIZE, e.g. TP101-BLK-01. Use before suggesting a new style number or SKU.',
  input: {},
  run: async (tx) => {
    const [codes, styles] = await Promise.all([
      tx.styleCode.findMany({ orderBy: [{ type: 'asc' }, { code: 'asc' }], select: { type: true, code: true, name: true, status: true } }),
      tx.style.findMany({ select: { number: true, categoryCode: true } }),
    ])
    const numbers = styles.map((s) => s.number)
    const of = (t: string) => codes.filter((c) => c.type === t)
    return {
      skuFormat: 'STYLE-COLOUR-SIZE, e.g. TP101-BLK-01',
      categories: of('CATEGORY').map((c) => ({ code: c.code, name: c.name, status: c.status, styles: styles.filter((s) => s.categoryCode === c.code).length, nextStyleNumber: nextStyleNumber(c.code, numbers) })),
      colors: of('COLOR').map((c) => ({ code: c.code, name: c.name, status: c.status })),
      sizes: of('SIZE').map((c) => ({ code: c.code, name: c.name, status: c.status })),
    }
  },
})

/**
 * What Muse may read (Brandon, 16 Oct 2026: Muse can connect too). Muse is an
 * outside researcher, and what it sees leaves the company (CLAUDE.md §4: never
 * customers, wholesale stores, bank figures or our people's opinions). So not
 * the notes, the open questions or the brief, which carry all of those, and
 * get_product leaves its notes out for Muse. Products, prices, POs, vendors
 * (already without contact or bank details) and the style system it can read.
 */
export const MUSE_TOOLS: ReadonlySet<string> = new Set(['list_products', 'get_product', 'wholesale_price_list', 'list_purchase_orders', 'get_purchase_order', 'list_vendors', 'style_system'])

export const MCP_TOOLS = [listProducts, getProduct, wholesalePriceList, listPurchaseOrders, getPurchaseOrder, listOpenQuestions, searchNotes, getLatestSnapshot, listVendors, styleSystem] as McpTool[]
