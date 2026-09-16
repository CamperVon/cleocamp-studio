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
export async function buildCatalog(): Promise<string> {
  const [products, components, vendors, locations, items, pos, runs, lastSale, notes, events, forecasts, alerts, people, finances, sales, wholesale, shopifySync, docDefaults, notify] = await Promise.all([
    db.product.findMany({
      orderBy: { name: 'asc' },
      include: {
        colorways: { orderBy: { customerName: 'asc' } },
        variants: { orderBy: [{ size: 'asc' }], include: { colorway: true } },
        bomLines: { include: { component: true } },
      },
    }),
    db.component.findMany({ orderBy: { name: 'asc' }, include: { vendor: true } }),
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
    // Retired notes come too, but only while they are recent enough to be worth
    // looking up; they are printed separately and clearly marked as past.
    db.note.findMany({
      where: {
        OR: [
          { supersededAt: null },
          { supersededAt: { gte: new Date(Date.now() - 90 * 864e5) } },
        ],
      },
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
        L.push(`  - ${b.component.name}: ${q === 0 ? 'UNKNOWN' : q} ${b.component.unitOfMeasure}`)
      }
    }
    if (p.variants.length) {
      L.push('variants (on hand / sold last 8 weeks):')
      for (const v of p.variants) {
        const name = [v.colorway?.customerName, v.size].filter(Boolean).join(' / ') || 'default'
        const oh = v.onHandQty === null ? 'UNKNOWN' : String(v.onHandQty)
        L.push(`  - ${name}: ${oh} on hand, ${sold.get(v.id) ?? 0} sold [${v.id}]`)
      }
    }
  }

  L.push('\n## Components')
  L.push('Fabric is bought per production run and shipped straight to the manufacturer.')
  L.push('It is never stocked or counted, so it has no on-hand figure by design.')
  for (const c of components) {
    const stock = c.stockedInStudio ? `${c.onHandQty} in studio` : 'not stocked — bought per run'
    L.push(`- ${c.name} [${c.id}] · ${c.category} · ${c.vendor?.name ?? 'no vendor'}${c.vendorSku ? ` · style ${c.vendorSku}` : ''} · ${money(c.unitCostCents)}/${c.unitOfMeasure} · lead time ${c.leadTimeDays === null ? 'UNKNOWN' : c.leadTimeDays + 'd'} · ${stock}${Number(c.incomingQty) > 0 ? `, ${c.incomingQty} incoming` : ''}`)
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
          (p.paymentTerms ? ` · ${p.paymentTerms}` : '') +
          (p.depositPercent
            ? (p.depositPaidAt ? ` · deposit paid ${p.depositPaidAt.toISOString().slice(0, 10)}` : ' · deposit NOT yet paid')
            : '') +
          (p.expectedAt ? ` · due ${p.expectedAt.toISOString().slice(0, 10)}` : ' · no date confirmed') +
          (p.deliverTo ? ` · delivers to ${p.deliverTo.split('\n')[0]}` : ''),
      )
    }
  }

  if (wholesale.length) {
    // What has shipped and what's owed — never a count. See CLAUDE.md and
    // WholesaleShipment's own comment: this tracks money and shipping
    // dates only, deliberately disconnected from inventory everywhere.
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
    // This was the 40 most recent notes, each cut to 260 characters, with no
    // indication of what the note was about. Against 78 notes that meant 38
    // never loaded, 31 more arrived half-finished mid-sentence, and the rest
    // read as context-free sentences with the subject stripped off — all of it
    // silent. Grouped by subject and shown in full instead, so a note about
    // Boy Belt stays findable under Boy Belt however old it gets, and anything
    // actually dropped is stated rather than quietly vanishing.
    // Budget by CHARACTERS, not rows. A row cap does not bound the thing that
    // actually costs anything: 200 one-line notes is 10k characters, 200 long
    // ones is 180k. Today's 104 notes are 30k, and the longest single note is
    // 931 characters — worth three short ones and no more expensive to carry.
    // Newest first, so what drops is always the oldest, and the count of what
    // dropped is printed below rather than left to be inferred.
    const BUDGET = 60_000
    // Live notes first and always. A retired one only earns space once every
    // current note has it, because the whole failure being fixed here is a
    // stale fact crowding out or outvoting the true one.
    const live = notes.filter((n) => !n.supersededAt)
    const retired = notes.filter((n) => n.supersededAt)
    const shown: typeof notes = []
    let used = 0
    for (const n of live) {
      used += n.content.length
      if (used > BUDGET && shown.length) break
      shown.push(n)
    }
    const shownRetired: typeof notes = []
    for (const n of retired) {
      used += n.content.length
      if (used > BUDGET) break
      shownRetired.push(n)
    }
    const dropped = live.length - shown.length

    const nameOf = new Map<string, string>()
    for (const p of products) nameOf.set(p.id, p.name)
    for (const c of components) nameOf.set(c.id, c.name)
    for (const v of vendors) nameOf.set(v.id, v.name)

    const groups = new Map<string, string[]>()
    for (const n of shown) {
      const subject = n.entityId
        ? `${nameOf.get(n.entityId) ?? n.entityType.toLowerCase().replace(/_/g, ' ')} [${n.entityId}]`
        : 'General'
      const list = groups.get(subject) ?? []
      list.push(n.content.replace(/\s+/g, ' '))
      groups.set(subject, list)
    }

    L.push('\n## Notes you have written')
    L.push('Everything under this heading is CURRENT. Anything retired is below,')
    L.push('under its own heading, and must never be quoted as though it still held.')
    if (dropped > 0) {
      L.push(`(${dropped} older note${dropped === 1 ? '' : 's'} not shown — say so if asked rather than implying you have seen everything.)`)
    }
    // General last: entity notes are what get looked up, general ones are
    // standing observations that read fine at the bottom.
    const keys = [...groups.keys()].sort((a, b) => (a === 'General' ? 1 : b === 'General' ? -1 : a.localeCompare(b)))
    for (const k of keys) {
      L.push(`\n### ${k}`)
      for (const c of groups.get(k)!) L.push(`- ${c}`)
    }

    if (shownRetired.length) {
      L.push('\n## NO LONGER TRUE — superseded notes, kept only for reference')
      L.push('These were replaced. Do NOT answer from them, do not average them')
      L.push('against a current note, and do not treat several old ones agreeing')
      L.push('as weight against one new one. They are here so an old figure can')
      L.push('be looked up on purpose — "what did we used to pay?" — nothing else.')
      for (const n of shownRetired) {
        const when = n.supersededAt!.toISOString().slice(0, 10)
        const subject = n.entityId ? nameOf.get(n.entityId) ?? n.entityType.toLowerCase().replace(/_/g, ' ') : 'General'
        L.push(`- [retired ${when}] (${subject}) ${n.content.replace(/\s+/g, ' ')}`)
      }
    }
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
    L.push(`- 8am morning report: ${onOff(notify.amReportEnabled)}`)
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

  return L.join('\n')
}
