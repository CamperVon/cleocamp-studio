import { lineScopeLabel } from '@/lib/bom'
import { createHash } from 'node:crypto'
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
/** notes: 'full' (default) prints every current note; 'index' prints one line per subject (chat). */
export async function buildCatalog(opts: { notes?: 'full' | 'index' } = {}): Promise<string> {
  const [products, components, vendors, locations, items, pos, runs, lastSale, notes, events, forecasts, alerts, people, finances, sales, wholesale, shopifySync, docDefaults, notify] = await Promise.all([
    db.product.findMany({
      orderBy: { name: 'asc' },
      include: {
        colorways: { orderBy: { customerName: 'asc' } },
        variants: { orderBy: [{ size: 'asc' }], include: { colorway: true } },
        bomLines: { include: { component: true } },
      },
    }),
    db.component.findMany({
      // A retired record (merged, split, discontinued) is history, not stock.
      where: { active: true },
      orderBy: { name: 'asc' },
      include: { vendor: true, locationStock: { include: { location: true, atVendor: true } } },
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
  const money = (c: number | null) => (c === null ? 'unknown' : `$${(c / 100).toFixed(2)}`)
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

  L.push('## Products')
  for (const p of products) {
    L.push(`\n### ${p.name} [${p.id}] — ${p.status.toLowerCase()}, retail ${money(p.retailPriceCents)}`)
    L.push(`production lead time: ${p.productionLeadTimeDays ?? 'UNKNOWN'}`)
    if (p.notes) L.push(`note: ${p.notes}`)
    if (p.colorways.length) {
      L.push('colourways (what customers see / what the dye house calls it):')
      for (const c of p.colorways) {
        L.push(`  - ${c.customerName}${c.dyeHouseName ? ` / ${c.dyeHouseName}` : c.inHouseMatch ? ' / IN-HOUSE MATCH, no dye house name' : ''}${c.active ? '' : ' (INACTIVE)'} [${c.id}]`)
      }
    }
    if (p.bomLines.length) {
      L.push('per unit:')
      for (const b of p.bomLines) {
        const q = Number(b.qtyPerUnit)
        L.push(`  - ${b.component.name}: ${q === 0 ? 'UNKNOWN' : q} ${b.component.unitOfMeasure}${lineScopeLabel(b)}`)
      }
    }
    if (p.variants.length) {
      L.push('variants (on hand / sold last 8 weeks):')
      // A product still in development can have ten variants that all read
      // "UNKNOWN on hand, 0 sold" — the 5to7 Skirt did, on every request.
      // Those are listed together on one line, ids kept so they can still be
      // written to. Never-counted and counted-at-zero stay separate lines:
      // they are different facts.
      const idle = { uncounted: [] as string[], zero: [] as string[] }
      for (const v of p.variants) {
        const name = [v.colorway?.customerName, v.size].filter(Boolean).join(' / ') || 'default'
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
    }
  }

  L.push('\n## Components')
  L.push('Every on-hand figure below is the current count from the ledger, wherever it')
  L.push('sits (studio or a vendor), fabric and leather included: it beats any note.')
  for (const c of components) {
    // Everything is counted wherever it sits (fabric too, since 2 Oct 2026), studio or a vendor (CLAUDE.md §3), and a count exists whether
    // or not stockedInStudio is set. Printing "not stocked" for anything that
    // wasn't a studio stash hid real numbers: on 25 Sept 2026 Mouse told
    // Brandon there were 2,100 Main labels and no Cosmo x Cleo labels, reading
    // a 16 Sept note, while the records held 4,010 and 2,000.
    const places = c.locationStock
      .filter((s) => Number(s.qty) !== 0)
      .map((s) => `${s.qty} at ${s.location?.name ?? s.atVendor?.name ?? 'unknown place'}`)
    const stock = `${c.onHandQty} on hand${places.length ? ` (${places.join(', ')})` : ''}${c.stockedInStudio ? '' : ' · bought per run'}`
    L.push(`- ${c.name} [${c.id}] · ${c.category} · ${c.vendor?.name ?? 'no vendor'}${c.vendorSku ? ` · style ${c.vendorSku}` : ''} · ${money(c.unitCostCents)}/${c.unitOfMeasure} · lead time ${c.leadTimeDays === null ? 'UNKNOWN' : c.leadTimeDays + 'd'} · ${stock}${Number(c.incomingQty) > 0 ? `, ${c.incomingQty} incoming` : ''}`)
  }

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
export async function buildCatalogParts(opts: { notes?: 'full' | 'index' } = {}): Promise<CatalogParts> {
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
