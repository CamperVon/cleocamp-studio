import { lineScopeLabel, onNoProduct } from '@/lib/bom'
import { createHash } from 'node:crypto'
import type { Prisma } from '@/generated/prisma/client'
import type { kitsByProduct } from '@/lib/kits'
import { renderNotesFull, renderNotesIndex } from '@/lib/mouse/notes'
import { db } from '@/lib/db'
import { poLineLabel } from '@/lib/po'
import { inventoryWritesEnabled } from './tools'

/**
 * Everything Studio Mouse knows, rendered for the system prompt.
 *
 * The whole catalogue goes in every turn rather than being retrieved. At this
 * scale it is a few thousand tokens, and it beats fuzzy matching — which fails
 * silently when "the pink one" doesn't substring-match a colourway called
 * "Rose". A miss is worse than the retrieval it replaces, because Claude then
 * answers without context it could have had.
 *
 * This block is cached, so it costs a tenth of the input rate after the first
 * turn. Keep it deterministic: no timestamps, stable ordering.
 */
/**
 * How a product or component is read, everywhere: the catalogue, open_record
 * and prefetch all load it with these, so a record looked up on its own reads
 * exactly as it does in the full catalogue.
 */
const PRODUCT_INCLUDE = {
  style: { select: { number: true, status: true } },
  colorways: { orderBy: { customerName: 'asc' } },
  variants: { orderBy: [{ size: 'asc' }], include: { colorway: true } },
  bomLines: { include: { component: true } },
} satisfies Prisma.ProductInclude
const COMPONENT_INCLUDE = {
  vendor: true, locationStock: { include: { location: true, atVendor: true } }, _count: { select: { usedIn: true } },
} satisfies Prisma.ComponentInclude
type CatalogProduct = Prisma.ProductGetPayload<{ include: typeof PRODUCT_INCLUDE }>
type CatalogComponent = Prisma.ComponentGetPayload<{ include: typeof COMPONENT_INCLUDE }>
type Kit = Awaited<ReturnType<typeof kitsByProduct>> extends Map<string, infer K> ? K : never

const money = (c: number | null) => (c === null ? 'unknown' : `$${(c / 100).toFixed(2)}`)

/**
 * The chat catalogue's Products and Components as an index (phase 2B, 8 Oct
 * 2026, MOUSE_CATALOG_INDEX, off by default). These are the words that head
 * each section in that mode, so Mouse knows what is not in front of it.
 */
export const PRODUCTS_INDEX_HEADER = [
  'Index view. Every product, status, retail, colourway and variant count is',
  'here. NOT shown: each product\'s notes field, its recipe (per-unit lines) and',
  'a known lead time ("notes field on file" and "recipe: N lines" say there is',
  'something to read). Before answering about or acting on any of those, open the',
  'product with open_record (the id in brackets). When a message names a record',
  'exactly, it may already be looked up in full with the message.',
]
export const COMPONENTS_INDEX_HEADER = [
  'Index view: name, supplier and stock. NOT shown: category, the supplier\'s style',
  'number, cost and a known lead time. Open the component with open_record before',
  'answering about or acting on those, or on which products use it.',
]

/** One product exactly as the full catalogue prints it. Pure. */
export function productFullLines(p: CatalogProduct, sold: Map<string, number>, kit: Kit | undefined): string[] {
  const L: string[] = []
  // The style number (docs/style-system/), "TP103 (PROPOSED)" when not confirmed.
  const style = p.style ? ` — style ${p.style.number}${p.style.status === 'PROPOSED' ? ' (PROPOSED)' : ''}` : ' — no style number'
  L.push(`\n### ${p.name} [${p.id}]${style} — ${p.status.toLowerCase()}, retail ${money(p.retailPriceCents)}`)
  L.push(`production lead time: ${p.productionLeadTimeDays ?? 'UNKNOWN'}`)
  if (p.notes) L.push(`note: ${p.notes}`)
  L.push(...colourwayLines(p))
  if (p.bomLines.length) {
    L.push('per unit:')
    for (const b of p.bomLines) {
      const q = Number(b.qtyPerUnit)
      L.push(`  - ${b.component.name}: ${q === 0 ? 'UNKNOWN' : q} ${b.component.unitOfMeasure}${lineScopeLabel(b)}`)
    }
  }
  L.push(...variantLines(p, sold), ...kitLines(kit))
  return L
}

/**
 * One product in the chat index: everything decision-critical or needed to
 * resolve a loose name stays (status, retail, every colourway with its dye
 * name, every variant count, the kit line); the notes field, recipe lines and
 * a known lead time are replaced by markers. Pure.
 */
export function productIndexLines(p: CatalogProduct, sold: Map<string, number>, kit: Kit | undefined): string[] {
  const L: string[] = []
  const style = p.style ? ` — style ${p.style.number}${p.style.status === 'PROPOSED' ? ' (PROPOSED)' : ''}` : ' — no style number'
  L.push(`\n### ${p.name} [${p.id}]${style} — ${p.status.toLowerCase()}, retail ${money(p.retailPriceCents)}`)
  const unknownQty = p.bomLines.filter((b) => Number(b.qtyPerUnit) === 0).length
  const markers = [
    p.productionLeadTimeDays === null ? 'production lead time: UNKNOWN' : null,
    p.notes?.trim() ? 'notes field on file' : null,
    p.bomLines.length ? `recipe: ${p.bomLines.length} line${p.bomLines.length === 1 ? '' : 's'}${unknownQty ? `, ${unknownQty} UNKNOWN qty` : ''}` : null,
  ].filter(Boolean)
  if (markers.length) L.push(markers.join(' · '))
  L.push(...colourwayLines(p), ...variantLines(p, sold), ...kitLines(kit))
  return L
}

function colourwayLines(p: CatalogProduct): string[] {
  if (!p.colorways.length) return []
  return [
    'colourways (what customers see / what the dye house calls it):',
    ...p.colorways.map((c) => `  - ${c.customerName}${c.dyeHouseName ? ` / ${c.dyeHouseName}` : c.inHouseMatch ? ' / IN-HOUSE MATCH, no dye house name' : ''}${c.active ? '' : ' (INACTIVE)'} [${c.id}]`),
  ]
}

function variantLines(p: CatalogProduct, sold: Map<string, number>): string[] {
  if (!p.variants.length) return []
  const L = ['variants (on hand / sold last 8 weeks):']
  // A product still in development can have ten variants that all read
  // "UNKNOWN on hand, 0 sold" — the 5to7 Skirt did, on every request.
  // Those are listed together on one line, ids kept so they can still be
  // written to. Never-counted and counted-at-zero stay separate lines:
  // they are different facts.
  const idle = { uncounted: [] as string[], zero: [] as string[] }
  for (const v of p.variants) {
    const name = ([v.colorway?.customerName, v.size].filter(Boolean).join(' / ') || 'default') + (v.newSku ? ` ${v.newSku}` : '')
    const n = sold.get(v.id) ?? 0
    if (n === 0 && (v.onHandQty === null || Number(v.onHandQty) === 0)) {
      idle[v.onHandQty === null ? 'uncounted' : 'zero'].push(`${name} [${v.id}]`)
      continue
    }
    const oh = v.onHandQty === null ? 'UNKNOWN' : String(v.onHandQty)
    L.push(`  - ${name}: ${oh} on hand, ${n} sold [${v.id}]`)
  }
  if (idle.uncounted.length) L.push(`  - UNKNOWN on hand, 0 sold: ${idle.uncounted.join(', ')}`)
  if (idle.zero.length) L.push(`  - 0 on hand, 0 sold: ${idle.zero.join(', ')}`)
  return L
}

// A kit (KitPart, 8 Oct 2026): made up from other products, so only as
// many can be made up as the scarcest part allows.
function kitLines(kit: Kit | undefined): string[] {
  if (!kit) return []
  return [`kit: ${kit.parts.join(' + ')}. Can be made up now (lower of the parts): ` +
    kit.lines.map((k) => `${k.colour ?? 'default'} ${k.available ?? 'UNKNOWN'} (${k.parts.map((x) => `${x.name} ${x.onHand ?? x.problem ?? 'UNKNOWN'}`).join(', ')})`).join('; ') +
    (kit.shared.length ? `. Each colour's figure is "up to": ${kit.shared.join('; ')}.` : '')]
}

// Everything is counted wherever it sits (fabric too, since 2 Oct 2026), studio or a vendor (CLAUDE.md §3), and a count exists whether
// or not stockedInStudio is set. Printing "not stocked" for anything that
// wasn't a studio stash hid real numbers: on 25 Sept 2026 Mouse told
// Brandon there were 2,100 Main labels and no Cosmo x Cleo labels, reading
// a 16 Sept note, while the records held 4,010 and 2,000.
function componentStock(c: CatalogComponent): string {
  const places = c.locationStock
    .filter((s) => Number(s.qty) !== 0)
    .map((s) => `${s.qty} at ${s.location?.name ?? s.atVendor?.name ?? 'unknown place'}`)
  return `${c.onHandQty} on hand${places.length ? ` (${places.join(', ')})` : ''}${c.stockedInStudio ? '' : ' · bought per run'}${Number(c.incomingQty) > 0 ? `, ${c.incomingQty} incoming` : ''}`
}

/** One component exactly as the full catalogue prints it. Pure. */
export function componentFullLine(c: CatalogComponent): string {
  return `- ${c.name} [${c.id}] · ${c.category} · ${c.vendor?.name ?? 'no vendor'}${c.vendorSku ? ` · style ${c.vendorSku}` : ''} · ${money(c.unitCostCents)}/${c.unitOfMeasure} · lead time ${c.leadTimeDays === null ? 'UNKNOWN' : c.leadTimeDays + 'd'} · ${componentStock(c)}${onNoProduct(c) ? ' · ON NO PRODUCT' : ''}`
}

/** One component in the chat index: name, id, supplier (kept, Brandon 8 Oct 2026), stock and its warnings. Pure. */
export function componentIndexLine(c: CatalogComponent): string {
  return `- ${c.name} [${c.id}] · ${c.vendor?.name ?? 'no vendor'}${c.leadTimeDays === null ? ' · lead time UNKNOWN' : ''} · ${componentStock(c)}${onNoProduct(c) ? ' · ON NO PRODUCT' : ''}`
}

/** Units sold per variant over the catalogue's eight weeks. */
async function soldByVariant(variantIds?: string[]): Promise<Map<string, number>> {
  const sales = await db.salesSnapshot.groupBy({
    by: ['productVariantId'],
    _sum: { unitsSold: true },
    where: { date: { gte: new Date(Date.now() - 56 * 864e5) }, ...(variantIds ? { productVariantId: { in: variantIds } } : {}) },
  })
  return new Map(sales.map((s) => [s.productVariantId, s._sum.unitsSold ?? 0]))
}

/**
 * Full catalogue entries for products and components, for open_record and
 * prefetch: the same lines the full catalogue prints for each, read now, in
 * one batch. A component also says which products use it and how much, since
 * recipes are not in the chat index. Keyed by id; an id that is not an active
 * record is absent.
 */
export async function catalogueEntries(productIds: string[], componentIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  if (!productIds.length && !componentIds.length) return out
  const { kitsByProduct } = await import('@/lib/kits')
  const [products, components, uses, kits] = await Promise.all([
    productIds.length ? db.product.findMany({ where: { id: { in: productIds } }, include: PRODUCT_INCLUDE }) : [],
    componentIds.length ? db.component.findMany({ where: { id: { in: componentIds }, active: true }, include: COMPONENT_INCLUDE }) : [],
    componentIds.length ? db.bomLine.findMany({ where: { componentId: { in: componentIds } }, include: { parentProduct: { select: { name: true } }, component: { select: { unitOfMeasure: true } } } }) : [],
    productIds.length ? kitsByProduct() : new Map(),
  ])
  const sold = await soldByVariant(products.flatMap((p) => p.variants.map((v) => v.id)))
  // The heading loses its "### ": the entry sits under the caller's own heading.
  for (const p of products) out.set(p.id, productFullLines(p, sold, kits.get(p.id)).map((l) => l.replace(/^\n(### )?/, '')))
  for (const c of components) {
    const used = uses.filter((b) => b.componentId === c.id && b.parentProduct).map((b) => {
      const q = Number(b.qtyPerUnit)
      return `  - ${b.parentProduct!.name}: ${q === 0 ? 'UNKNOWN' : q} ${b.component.unitOfMeasure}${lineScopeLabel(b)}`
    }).sort()
    out.set(c.id, [componentFullLine(c), ...(used.length ? ['used per unit in:', ...used] : [])])
  }
  return out
}

/** MOUSE_CATALOG_INDEX: chat reads Products and Components as an index (phase 2B). Off unless exactly "1". */
export function catalogIndexOn(): boolean {
  return process.env.MOUSE_CATALOG_INDEX === '1'
}

/**
 * notes: 'full' (default) prints every current note; 'index' prints one line per subject (chat).
 * catalog: 'full' (default) prints every product and component in full; 'index' (chat, behind
 * MOUSE_CATALOG_INDEX) prints them as an index, the rest on demand.
 */
export async function buildCatalog(opts: { notes?: 'full' | 'index'; catalog?: 'full' | 'index' } = {}): Promise<string> {
  const [products, components, vendors, locations, items, pos, runs, lastSale, notes, events, forecasts, alerts, people, finances, sales, wholesale, shopifySync, docDefaults, notify] = await Promise.all([
    db.product.findMany({ orderBy: { name: 'asc' }, include: PRODUCT_INCLUDE }),
    db.component.findMany({
      // A retired record (merged, split, discontinued) is history, not stock.
      where: { active: true },
      orderBy: { name: 'asc' },
      include: COMPONENT_INCLUDE,
    }),
    db.vendor.findMany({ orderBy: { name: 'asc' } }),
    db.location.findMany({ orderBy: { name: 'asc' } }),
    db.actionItem.findMany({ where: { resolved: false }, orderBy: { createdAt: 'asc' } }),
    db.purchaseOrder.findMany({
      where: { status: { in: ['DRAFT', 'SENT', 'PARTIALLY_RECEIVED'] } },
      include: { vendor: true, forProduct: true, lines: { orderBy: { id: 'asc' }, include: { component: true, productVariant: { include: { product: true, colorway: true } } } } },
    }),
    db.productionRun.findMany({
      where: { status: { notIn: ['RECEIVED', 'CANCELLED'] } },
      include: { product: true, vendor: true },
      orderBy: { expectedReadyAt: 'asc' },
    }),
    db.salesSnapshot.aggregate({ _max: { date: true } }),
    // No row cap — buildCatalog budgets these by character count below.
    // Current notes only. Retired ones were printed in full under their own
    // heading until 24 Sept 2026 (for 90 days, then 14). The day 71 were
    // retired in one tidy, the catalogue got LARGER. They are for looking an
    // old figure up on purpose, which query_status "retiredNotes" does.
    db.note.findMany({
      where: { supersededAt: null },
      orderBy: { createdAt: 'desc' },
    }),
    db.calendarEvent.findMany({
      where: { date: { gte: new Date(Date.now() - 864e5) } },
      orderBy: { date: 'asc' }, take: 25,
    }),
    db.forecastResult.findMany({ include: { product: true, component: true } }),
    db.alert.findMany({ where: { resolved: false }, orderBy: { createdAt: 'desc' } }),
    db.person.findMany({ where: { active: true } }),
    db.financialSnapshot.findFirst({ orderBy: { forDate: 'desc' } }),
    db.salesSnapshot.groupBy({
      by: ['productVariantId'],
      _sum: { unitsSold: true },
      where: { date: { gte: new Date(Date.now() - 56 * 864e5) } },
    }),
    db.wholesaleAccount.findMany({
      where: { active: true },
      include: { shipments: { include: { lines: true }, orderBy: { sentAt: 'desc' } } },
    }),
    db.shopifySyncStatus.findUnique({ where: { id: 'singleton' } }),
    db.documentDefaults.findUnique({ where: { id: 'singleton' } }),
    db.notificationSettings.findUnique({ where: { id: 'singleton' } }),
  ])

  const sold = new Map(sales.map((s) => [s.productVariantId, s._sum.unitsSold ?? 0]))
  const { kitsByProduct } = await import('@/lib/kits')
  const kits = await kitsByProduct()
  const L: string[] = []

  // Without this it cannot reason about lead times, due dates or "as of today",
  // and correctly refuses to guess — which means asking Cleo what day it is.
  const today = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  }).format(new Date())
  const iso = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
  L.push(`## Today\n${today} (${iso}), Los Angeles time.\n`)

  // It could see the numbers but not where they came from, so asked whether
  // Shopify was connected while reading Shopify's own figures.
  L.push('## Where these numbers come from')
  L.push('Shopify is connected and is the master for finished goods. Variant counts,')
  L.push('retail prices and sales history are pulled from it and refreshed by the')
  L.push('nightly job, and again each morning before the 8am report. You can pull a')
  L.push('fresh copy yourself with sync_shopify.')
  L.push(
    shopifySync
      ? `Last actually synced: ${shopifySync.lastSyncedAt.toISOString()} (${shopifySync.variantsUpdated} variants).`
      : 'Never actually synced — the numbers below have not come from Shopify yet.',
  )
  L.push(
    `Sales history currently runs to ${
      lastSale._max.date ? lastSale._max.date.toISOString().slice(0, 10) : 'no sales recorded'
    }.`,
  )
  L.push(
    inventoryWritesEnabled()
      ? 'Writing back to Shopify IS switched on: log_inventory_event and correct_inventory_event ' +
        'push the same change to Shopify for any variant with a Shopify link on file. Its own ' +
        'result tells you whether that push actually happened — read it, do not assume.'
      : 'Writing back to Shopify is NOT switched on. You can read it; you cannot change it. ' +
        'Say so plainly if asked to.',
  )
  L.push('')

  const index = opts.catalog === 'index'
  L.push('## Products')
  if (index) L.push(...PRODUCTS_INDEX_HEADER)
  for (const p of products) L.push(...(index ? productIndexLines : productFullLines)(p, sold, kits.get(p.id)))

  L.push('\n## Components')
  L.push('Every on-hand figure below is the current count from the ledger, wherever it')
  L.push('sits (studio or a vendor), fabric and leather included: it beats any note.')
  if (index) L.push(...COMPONENTS_INDEX_HEADER)
  for (const c of components) L.push(index ? componentIndexLine(c) : componentFullLine(c))
  // Brandon, 7 Oct 2026, finding 16 leathers and silks on no product: "make
  // sure this never happens again." Said out loud every turn until fixed.
  const orphans = components.filter(onNoProduct)
  if (orphans.length) {
    L.push(`\n${orphans.length} component${orphans.length === 1 ? ' is' : 's are'} on no product, so ${orphans.length === 1 ? 'it does' : 'they do'} not show on Products and the forecast cannot count ${orphans.length === 1 ? 'it' : 'them'}: ${orphans.map((c) => c.name).join('; ')}. ` +
      'When one comes up, or the person has a moment, ask which product it goes into and put it there with update_product_bom (quantity unknown is fine). Never guess the product.')
  }

  // Style numbers (8 Oct 2026): what is still unsettled, one line when nothing is.
  const { styleReport } = await import('@/lib/style-report')
  L.push('\n## Style system')
  L.push(...(await styleReport()).map((l) => `- ${l}`))

  // A purchase order line names a component, or a variant, or neither — the
  // last kind is free text, because an order is often how a new thing first
  // exists (a colour nobody has dyed, a label nobody has printed). Those lines
  // attach to no catalogue row, so no on-hand or incoming figure anywhere can
  // account for them, and they are invisible to the forecast by construction.
  //
  // Brandon, 18 Sept 2026, after Mouse called the hang tags uncounted with an
  // order for them outstanding: "We have a PO out for that and you should know
  // that." The hang tags were not even this case — they had no PO row at all —
  // but 1,600 Cosmo x Cleo labels and twenty Bean Bags were sitting in exactly
  // this blind spot on live orders while he asked. Listing them is the cheap
  // half of the fix: Mouse cannot count them, but it can stop saying there are
  // none.
  const looseLines = pos
    .flatMap((po) =>
      po.lines
        .filter((l) => !l.componentId && !l.productVariantId)
        .filter((l) => Number(l.qtyOrdered) > Number(l.qtyReceived))
        .map((l) => ({ po, l })),
    )
    .sort((a, b) => a.po.poNumber.localeCompare(b.po.poNumber) || a.l.id.localeCompare(b.l.id))

  if (looseLines.length) {
    L.push('\n## On order, but attached to no catalogue row')
    L.push('These are real outstanding quantities on real orders. They match no')
    L.push('component or variant, so they appear in NO on-hand or incoming figure')
    L.push('above and the forecast cannot see them. Before saying there is none of')
    L.push('something, read this list — and if one of these is a thing that ought to')
    L.push('exist properly, say so, rather than quietly ordering it twice.')
    for (const { po, l } of looseLines) {
      const left = Number(l.qtyOrdered) - Number(l.qtyReceived)
      L.push(
        `- ${left} ${l.unit} — ${l.description ?? 'unlabelled line'} · PO ${po.poNumber} (${po.vendor.name})` +
          `${po.status === 'DRAFT' ? ' · STILL A DRAFT, not ordered yet' : ''}`,
      )
    }
  }

  // Without these, a component event at the studio is unloggable: writeEvent
  // demands a locationId or atVendorId for anything that is not a studio
  // stash, and Mouse had no way to learn the id. On 15 Sept 2026 it was told
  // buttons were going to the studio, correctly refused to guess, and filed a
  // question asking a person for a database id — which Cleo cannot answer.
  L.push('\n## Places')
  L.push('Use these ids for locationId on log_inventory_event. A vendor holding')
  L.push('stock goes in atVendorId instead, using the vendor ids below.')
  for (const l of locations) {
    L.push(`- ${l.name} [${l.id}]${l.isDefault ? ' — the studio itself, the default place' : ''}`)
  }

  L.push('\n## Vendors')
  for (const v of vendors) {
    L.push(`- ${v.name}${v.legalName ? ` (${v.legalName})` : ''} [${v.id}] · ${v.role}${v.active ? '' : ' · INACTIVE, replaced'}${v.contactName ? ` · ${v.contactName}` : ''}${v.orderMethod ? ` · order by ${v.orderMethod}` : ''} · email: ${v.email ?? 'UNKNOWN — send_purchase_order will refuse without it'}${v.ccEmails ? ` · always cc: ${v.ccEmails}` : ''}`)
  }

  // Without this it cannot see its own production runs, and creates a fresh
  // one every time it is told about the same job.
  L.push('\n## Production runs in flight')
  if (!runs.length) {
    L.push('(none)')
  } else {
    for (const r of runs) {
      L.push(
        `- ${r.product.name} [${r.id}] at ${r.vendor?.name ?? 'no maker set'} · ${r.status}` +
          (r.cutRef ? ` · ${r.cutRef}` : '') +
          (r.statusSummary ? ` · ${r.statusSummary}` : '') +
          ` · ready ${r.expectedReadyAt ? r.expectedReadyAt.toISOString().slice(0, 10) : 'UNKNOWN'}` +
          (r.dateConfirmed ? '' : ' (not confirmed)') +
          (r.notes ? ` · ${r.notes}` : ''),
      )
    }
    L.push('Before creating a run, check this list. If one already exists for the')
    L.push('same product and job, UPDATE it rather than adding another.')
  }

  if (pos.length) {
    L.push('\n## Open purchase orders')
    for (const p of pos) {
      const lines = p.lines.map((l) => `${l.qtyOrdered} ${l.unit} ${poLineLabel(l)}`).join(', ')
      L.push(
        `- PO ${p.poNumber} to ${p.vendor.name}: ${lines}` +
          (p.forProduct ? ` for the ${p.forProduct.name}` : '') +
          ` · ${p.status}` +
          (p.currency !== 'USD' ? ` · priced in ${p.currency}` : '') +
          (p.paymentTerms ? ` · ${p.paymentTerms}` : '') +
          (p.depositPercent
            ? (p.depositPaidAt ? ` · deposit paid ${p.depositPaidAt.toISOString().slice(0, 10)}` : ' · deposit NOT yet paid')
            : '') +
          (p.expectedAt ? ` · due ${p.expectedAt.toISOString().slice(0, 10)}` : ' · no date confirmed') +
          (p.deliverTo ? ` · delivers to ${p.deliverTo.split('\n')[0]}` : '') +
          // What the vendor reads on the document, so a change to the notes
          // keeps what is there (update_purchase_order replaces them).
          (p.notes?.trim() ? ` · printed notes: "${p.notes.trim().replace(/\s+/g, ' ').slice(0, 300)}"` : ''),
      )
    }
  }

  // What came in from Shopify this week, by itself or by hand (lib/shopify-catchup.ts),
  // so Mouse knows a new product or colour without being told (8 Oct 2026).
  const arrived = await import('@/lib/shopify-catchup').then((m) => m.arrivedFromShopify(new Date(Date.now() - 7 * 864e5))).catch(() => [] as string[])
  if (arrived.length) {
    L.push('\n## New from Shopify in the last 7 days')
    for (const a of arrived) L.push(`- ${a}`)
  }

  // Research handed to Muse, the outside researcher: titles and state only.
  // The report itself is read with muse_tasks, as information.
  const muse = await db.museTask.findMany({
    where: { OR: [{ status: 'OPEN' }, { status: 'REPORTED', reportedAt: { gte: new Date(Date.now() - 14 * 864e5) } }] },
    orderBy: { createdAt: 'asc' }, take: 15,
    select: { id: true, number: true, title: true, status: true, pickedUpAt: true, reportedAt: true, questions: { select: { status: true } } },
  }).catch(() => [])
  if (muse.length) {
    L.push('\n## With Muse (outside research)')
    for (const t of muse) {
      const waiting = t.questions.filter((q) => q.status !== 'ANSWERED').length
      L.push(`- Task ${t.number} [${t.id}] ${t.title} · ${t.reportedAt ? `reported ${t.reportedAt.toISOString().slice(0, 10)}, not yet closed` : t.pickedUpAt ? 'Muse is working on it' : 'not picked up yet'}${waiting ? ` · ${waiting} question${waiting === 1 ? '' : 's'} waiting on the team` : ''}`)
    }
  }

  if (wholesale.length) {
    // What has shipped and what's owed — never a count. See CLAUDE.md and
    // WholesaleShipment's own comment: this tracks money and shipping
    // dates only, deliberately disconnected from inventory everywhere.
    // Every store, with its id, even one with nothing shipped yet: a store
    // Mouse had just made was invisible here, so it could not invoice it
    // (Waymo Commercial, 5 Oct 2026).
    L.push('\n## Wholesale stores on file')
    for (const a of wholesale) L.push(`- ${a.name} [${a.id}] · ${a.type}${a.contactName ? ` · contact ${a.contactName}` : ''} · ${a.email ? `email ${a.email}` : 'NO EMAIL'} · ${a.address ? `address ${a.address}` : 'NO ADDRESS'}`)
    L.push('\n## Wholesale — shipped, paid or not')
    for (const a of wholesale) {
      if (!a.shipments.length) continue
      L.push(`\n### ${a.name} [${a.id}] · ${a.type}${a.commissionSplit ? ` ${a.commissionSplit}` : ''}`)
      for (const s of a.shipments) {
        const total = s.lines.reduce((n, l) => n + (l.wholesaleCents ?? 0), 0)
        const paidStr = s.paid === true ? `paid${s.paidAt ? ' ' + s.paidAt.toISOString().slice(0, 10) : ''}`
          : s.paid === false ? 'UNPAID' : 'payment status not confirmed'
        const soldStr = a.type === 'CONSIGNMENT'
          ? ` · ${s.lines.filter((l) => l.soldAt).length}/${s.lines.length} sold` : ''
        L.push(
          `- [${s.id}] ${s.sentAt.toISOString().slice(0, 10)}: ${s.lines.length} lines, ` +
            `${total ? money(total) : 'no total recorded'} · ${paidStr}${soldStr}` +
            (s.notes ? ` · ${s.notes}` : ''),
        )
      }
    }
  }

  {
    const { stylistContext } = await import('@/lib/stylists')
    const st = await stylistContext().catch(() => '')
    if (st) L.push('\n## ' + st)
  }

  if (forecasts.length) {
    L.push('\n## Your own forecasts, from the last nightly run')
    for (const f of forecasts) {
      const who = f.product?.name ?? f.component?.name ?? '?'
      L.push(
        `- ${who}: ${f.blockedReason ? 'BLOCKED — ' + f.blockedReason : f.note}` +
          (f.recommendedOrderDate ? ` Order by ${f.recommendedOrderDate.toISOString().slice(0, 10)}.` : ''),
      )
    }
  }

  if (alerts.length) {
    L.push('\n## Alerts you have raised, still open')
    // The id is here so dismiss_alert can actually be called. Without it Mouse
    // could see an alert, agree it was stale, and have no way to name it.
    for (const a of alerts) L.push(`- [${a.id}] ${a.severity}: ${a.message}`)
  }

  if (events.length) {
    L.push('\n## Calendar, from today onward')
    L.push('PICKUP/DELIVERY entries are goods physically moving between the studio')
    L.push('and a vendor. They are a heads-up, not a record: never log stock off the')
    L.push('back of one. Ask what actually moved and who has it now.')
    for (const e of events) {
      const tag =
        e.type === 'DELIVERY_EXPECTED' ? ' [PICKUP/DELIVERY]'
        : e.source === 'GOOGLE' ? ' (studio calendar)'
        : ''
      L.push(`- ${e.date.toISOString().slice(0, 10)} ${e.title}${tag}${e.notes ? ` — ${e.notes.replace(/\s+/g, ' ')}` : ''}`)
    }
  }

  if (notes.length) {
    // Grouped by subject; see lib/mouse/notes.ts for the history. Chat gets
    // the index (phase 2A, 6 Oct 2026): one line per subject, full notes via
    // open_record or prefetch, notes with no subject in full. Everything
    // else that reads the catalogue gets every note in full, as before.
    const openPo = new Set(pos.flatMap((p) => [p.id, String(p.poNumber), `PO ${p.poNumber}`]))
    const countKinds = { type: { in: ['COUNTED', 'RECEIVED', 'CORRECTION'] as ('COUNTED' | 'RECEIVED' | 'CORRECTION')[] }, source: { not: 'SYSTEM' as const } }
    const [byComponent, byVariant] = await Promise.all([
      db.inventoryEvent.groupBy({ by: ['componentId'], where: { ...countKinds, componentId: { not: null } }, _max: { createdAt: true } }),
      db.inventoryEvent.groupBy({ by: ['productVariantId'], where: { ...countKinds, productVariantId: { not: null } }, _max: { createdAt: true } }),
    ])
    const latestCount = new Map<string, Date>()
    const bump = (id: string, d: Date | null) => { if (d && (!latestCount.has(id) || latestCount.get(id)! < d)) latestCount.set(id, d) }
    for (const g of byComponent) bump(g.componentId!, g._max.createdAt)
    const productOf = new Map(products.flatMap((p) => p.variants.map((v) => [v.id, p.id] as const)))
    for (const g of byVariant) { bump(g.productVariantId!, g._max.createdAt); bump(productOf.get(g.productVariantId!) ?? '', g._max.createdAt) }

    const nameOf = new Map<string, string>()
    for (const p of products) nameOf.set(p.id, p.name)
    for (const c of components) nameOf.set(c.id, c.name)
    for (const v of vendors) nameOf.set(v.id, v.name)
    const input = { notes, openPoKeys: openPo, nameOf, latestCount }
    L.push(...(opts.notes === 'index' ? renderNotesIndex(input) : renderNotesFull(input)))
  }

  if (people.length) {
    L.push('\n## People')
    for (const p of people) L.push(`- ${p.name}${p.role ? ` — ${p.role}` : ''}`)
  }

  if (finances) {
    L.push('\n## Money, as last recorded')
    L.push(
      `As of ${finances.forDate.toISOString().slice(0, 10)}: ` +
        `${finances.cashCents === null ? 'cash unknown' : '$' + (Number(finances.cashCents) / 100).toLocaleString()} in the bank, ` +
        `${finances.apCents === null ? 'card unknown' : '$' + (Number(finances.apCents) / 100).toLocaleString()} owed on the card.`,
    )
    // Cleo, 16 Sept: stop flagging this. The old line ended "these do not
    // refresh on their own", which read as a standing complaint and had Mouse
    // opening the brief with the cash figure being stale — every day, about a
    // number that is deliberately not maintained. Cash came off the Finances
    // page on 12 Sept because QuickBooks exposes no live bank balance. Say how
    // old it is when asked; do not volunteer it as a problem.
    L.push(
      'Cash is NOT tracked here and is not expected to be current. Cleo removed it',
      'from the Finances page deliberately. Never raise its age as an alert, a',
      'warning, or a line in the daily brief. If she asks about cash, give the date',
      'it is as of and leave it there.',
    )
  }

  if (notify) {
    const onOff = (b: boolean) => (b ? 'ON' : 'off')
    L.push('\n## Scheduled emails')
    L.push('Switch any of these with update_notification_settings — yours to change')
    L.push('when asked, not something to log for someone else.')
    L.push(`- Two todo questions a day: ${onOff(notify.chipAwayEnabled)}`)
    L.push(`- The Daily Cheese (weekday 8am, red items only): ${onOff(notify.dailyCheeseEnabled)}`)
    L.push(`- 8am morning report, superseded by The Daily Cheese: ${onOff(notify.amReportEnabled)}`)
    L.push(`- Older daily/weekly digest: ${onOff(notify.digestEnabled)}`)
  }

  if (docDefaults) {
    // Needed to append rather than blindly replace: update_document_defaults
    // overwrites what it is given, so knowing the current value is the
    // difference between "add Nicki" and "delete everyone but Nicki".
    L.push('\n## What every printed document currently says')
    L.push('Editable with update_document_defaults (all documents) or')
    L.push("update_purchase_order's contactLines (one order). Layout is not editable.")
    L.push(`- Bill to: ${docDefaults.billToLines.replace(/\n/g, ' / ')}`)
    L.push(`- Confirm line: ${docDefaults.confirmLine}`)
    L.push(`- Confirm with: ${docDefaults.contactLines.replace(/\n/g, ' / ')}`)
  }

  L.push('\n## Open questions and todos')
  L.push('These are things you already know you do not know. Do not re-ask them')
  L.push('unless the conversation touches them; if the user answers one, resolve it.')
  for (const i of items) {
    L.push(`- [${i.id}] ${i.kind}: ${i.title}`)
  }

  // Customer support — counts only. The words of a customer email are never
  // put in front of this Mouse, which has write tools; anyone on the internet
  // can write to support@. The cases themselves are on the Support tab.
  const support = await db.supportCase.groupBy({
    by: ['category', 'urgency'],
    where: { status: 'OPEN', category: { not: 'SPAM' } },
    _count: true,
  })
  if (support.length) {
    const total = support.reduce((n, g) => n + g._count, 0)
    const fires = support.filter((g) => g.urgency === 'NOW').reduce((n, g) => n + g._count, 0)
    L.push('\n## Customer support (support@cleocamp.com)')
    L.push(
      `${total} open case${total === 1 ? '' : 's'}${fires ? `, ${fires} marked urgent` : ''}: ` +
        support.map((g) => `${g._count} ${g.category.toLowerCase().replace(/_/g, ' ')}${g.urgency === 'NOW' ? ' (urgent)' : ''}`).join(', ') +
        '. You cannot read or answer these — they are on the Support tab (/support). Nothing is sent to customers yet.',
    )
  }

  return L.join('\n')
}

/**
 * The catalogue in two cache blocks (6 Oct 2026, phase 1 of the cost plan).
 *
 * The whole catalogue sat behind one five-minute cache mark, so it was
 * written again on nearly every turn: turns are usually more than five
 * minutes apart and any write changes the text. Sections that rarely change
 * now go in a block of their own with the one-hour mark, ahead of the rest.
 *
 * Nothing is added, dropped, shortened or reworded: the catalogue is built
 * exactly as before and cut at its "## " headings. Each section's text is
 * byte for byte what it was. Only the order of whole sections changes:
 * stable ones first, then the live ones in their usual order.
 *
 * Stable is an allowlist, and every section not on it is live. Notes are
 * live on purpose (Brandon, 6 Oct 2026: high-churn and business-critical),
 * as are the date, counts, stock, orders, runs, forecasts, alerts, calendar,
 * to-dos and money. The five below change only when someone edits a place,
 * a vendor's details, a wholesale store, a person, or the printed document
 * defaults; none of them carries a count, a status or a date.
 */
export const STABLE_SECTIONS: readonly string[] = [
  'Places',
  'Vendors',
  'Wholesale stores on file',
  'People',
  'What every printed document currently says',
]

export type CatalogSection = { heading: string; text: string; stable: boolean }
export type CatalogParts = { stable: string; live: string; sections: CatalogSection[] }

/**
 * Cut the catalogue at its section headings and sort the sections into
 * stable and live, each keeping its original order. Anything before the
 * first heading, and any heading not on the allowlist, is live. Pure.
 */
export function splitCatalog(text: string): CatalogParts {
  const starts = [...text.matchAll(/^## /gm)].map((m) => m.index!)
  const cuts = starts[0] === 0 ? starts : [0, ...starts]
  const sections: CatalogSection[] = cuts.map((at, k) => {
    const chunk = text.slice(at, cuts[k + 1] ?? text.length)
    const heading = chunk.startsWith('## ') ? chunk.slice(3, chunk.indexOf('\n') === -1 ? undefined : chunk.indexOf('\n')).trim() : ''
    return { heading, text: chunk, stable: STABLE_SECTIONS.includes(heading) }
  }).filter((s) => s.text.length > 0)
  // Fail safe: a stable heading seen twice means some text (a note with a
  // line reading "## Vendors", say) looks like a section. Rather than guess
  // which is real, nothing goes in the long-lived block this time.
  const stableHeads = sections.filter((s) => s.stable).map((s) => s.heading)
  if (new Set(stableHeads).size !== stableHeads.length) for (const s of sections) s.stable = false
  return {
    stable: sections.filter((s) => s.stable).map((s) => s.text).join(''),
    live: sections.filter((s) => !s.stable).map((s) => s.text).join(''),
    sections,
  }
}

/** The catalogue, built as always, in its two blocks. */
export async function buildCatalogParts(opts: { notes?: 'full' | 'index'; catalog?: 'full' | 'index' } = {}): Promise<CatalogParts> {
  return splitCatalog(await buildCatalog(opts))
}

/**
 * Sizes, not contents, for the usage record: each section's heading, bytes
 * and a rough token estimate, which block it went in, and a short hash of
 * each block so successive turns show whether a block was byte-identical
 * (and so could have been read from cache). No business text is kept. Pure.
 */
export type CatalogStats = {
  blocks: { stable: boolean; live: boolean }
  stable: { bytes: number; estTokens: number; hash: string }
  live: { bytes: number; estTokens: number; hash: string }
  sections: Array<{ heading: string; bytes: number; estTokens: number; block: 'stable' | 'live' }>
}

export function catalogStats(p: CatalogParts): CatalogStats {
  const bytes = (s: string) => Buffer.byteLength(s, 'utf8')
  // About four characters a token for English prose: an estimate, labelled as one.
  const est = (s: string) => Math.ceil(s.length / 4)
  const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 12)
  return {
    blocks: { stable: p.stable.length > 0, live: p.live.length > 0 },
    stable: { bytes: bytes(p.stable), estTokens: est(p.stable), hash: hash(p.stable) },
    live: { bytes: bytes(p.live), estTokens: est(p.live), hash: hash(p.live) },
    sections: p.sections.map((s) => ({ heading: s.heading || '(before the first heading)', bytes: bytes(s.text), estTokens: est(s.text), block: s.stable ? 'stable' : 'live' })),
  }
}
