import { db } from '@/lib/db'
import { type NoteRow, type RecordRef, mentionedRecords, noteLine, prefetchBlock, resolveRecord } from '@/lib/mouse/notes'

/**
 * Reading one record and its notes, for open_record and for prefetch (phase
 * 2A of the cost plan, 6 Oct 2026). Read-only: nothing here writes.
 */

/** Every record a note can be about, with the exact strings that name it. */
export async function recordDirectory(): Promise<RecordRef[]> {
  const [products, components, vendors, pos, runs, accounts, subjects] = await Promise.all([
    db.product.findMany({ select: { id: true, name: true } }),
    db.component.findMany({ where: { active: true }, select: { id: true, name: true } }),
    db.vendor.findMany({ select: { id: true, name: true, legalName: true } }),
    db.purchaseOrder.findMany({ select: { id: true, poNumber: true, vendor: { select: { name: true } } } }),
    db.productionRun.findMany({ select: { id: true, product: { select: { name: true } }, cutRef: true } }),
    db.wholesaleAccount.findMany({ select: { id: true, name: true } }),
    db.note.findMany({ where: { supersededAt: null, entityId: { not: null } }, select: { entityId: true }, distinct: ['entityId'] }),
  ])
  const dir: RecordRef[] = [
    ...products.map((p) => ({ kind: 'product' as const, id: p.id, name: p.name, keys: [p.id, p.name] })),
    ...components.map((c) => ({ kind: 'component' as const, id: c.id, name: c.name, keys: [c.id, c.name] })),
    ...vendors.map((v) => ({ kind: 'vendor' as const, id: v.id, name: v.name, keys: [v.id, v.name, ...(v.legalName ? [v.legalName] : [])] })),
    ...pos.map((p) => ({ kind: 'purchase order' as const, id: p.id, name: `PO ${p.poNumber} · ${p.vendor.name}`, keys: [p.id, String(p.poNumber), `PO ${p.poNumber}`] })),
    ...runs.map((r) => ({ kind: 'production run' as const, id: r.id, name: `${r.product.name} run${r.cutRef ? ` ${r.cutRef}` : ''}`, keys: [r.id] })),
    ...accounts.map((a) => ({ kind: 'wholesale account' as const, id: a.id, name: a.name, keys: [a.id, a.name] })),
  ]
  // A note's subject that is none of the above ("stylists", an id of
  // something since deleted) is still a subject open_record can return.
  const known = new Set(dir.flatMap((r) => r.keys))
  for (const s of subjects) {
    if (s.entityId && !known.has(s.entityId)) dir.push({ kind: 'note subject', id: s.entityId, name: s.entityId, keys: [s.entityId] })
  }
  return dir
}

/** The ids a record's notes may be filed under: a PO by id, number or "PO n"; a product also by its variants. */
export async function noteKeysFor(r: RecordRef): Promise<string[]> {
  if (r.kind === 'product') {
    const vs = await db.productVariant.findMany({ where: { productId: r.id }, select: { id: true } })
    return [r.id, ...vs.map((v) => v.id)]
  }
  return r.keys.filter((k) => r.kind !== 'purchase order' || k === r.id || /^\d+$/.test(k) || /^PO \d+$/.test(k))
}

/** When each thing was last counted, received or corrected by a person: the stale-count warning's input. */
export async function latestCounts(ids?: string[]): Promise<Map<string, Date>> {
  const countKinds = { type: { in: ['COUNTED', 'RECEIVED', 'CORRECTION'] as ('COUNTED' | 'RECEIVED' | 'CORRECTION')[] }, source: { not: 'SYSTEM' as const } }
  const [byComponent, byVariant, variants] = await Promise.all([
    db.inventoryEvent.groupBy({ by: ['componentId'], where: { ...countKinds, componentId: ids ? { in: ids } : { not: null } }, _max: { createdAt: true } }),
    db.inventoryEvent.groupBy({ by: ['productVariantId'], where: { ...countKinds, productVariantId: { not: null } }, _max: { createdAt: true } }),
    db.productVariant.findMany({ select: { id: true, productId: true } }),
  ])
  const m = new Map<string, Date>()
  const bump = (id: string, d: Date | null) => { if (d && (!m.has(id) || m.get(id)! < d)) m.set(id, d) }
  for (const g of byComponent) bump(g.componentId!, g._max.createdAt)
  const productOf = new Map(variants.map((v) => [v.id, v.productId]))
  for (const g of byVariant) { bump(g.productVariantId!, g._max.createdAt); bump(productOf.get(g.productVariantId!) ?? '', g._max.createdAt) }
  return m
}

async function currentNotes(keys: string[]): Promise<NoteRow[]> {
  if (!keys.length) return []
  return db.note.findMany({
    where: { entityId: { in: keys }, supersededAt: null },
    orderBy: { createdAt: 'desc' },
    select: { id: true, entityType: true, entityId: true, content: true, createdAt: true },
  })
}

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null)

/** The record itself, briefly: enough to act on it, not a second catalogue. */
async function detailFor(r: RecordRef): Promise<Record<string, unknown>> {
  switch (r.kind) {
    case 'product': {
      const p = await db.product.findUnique({ where: { id: r.id }, include: { variants: { include: { colorway: true }, orderBy: { size: 'asc' } } } })
      return p ? { status: p.status, variants: p.variants.map((v) => ({ id: v.id, label: [v.colorway?.customerName, v.size].filter(Boolean).join(' / ') || 'default', onHand: v.onHandQty === null ? 'UNKNOWN' : Number(v.onHandQty) })) } : {}
    }
    case 'component': {
      const c = await db.component.findUnique({ where: { id: r.id }, include: { vendor: true, locationStock: { include: { location: true, atVendor: true } } } })
      return c ? {
        category: c.category, unit: c.unitOfMeasure, supplier: c.vendor?.name ?? null, supplierDescription: c.vendorDescription, spec: c.spec,
        costPerUnitCents: c.unitCostCents, leadTimeDays: c.leadTimeDays, onHand: Number(c.onHandQty), incoming: Number(c.incomingQty),
        byPlace: c.locationStock.filter((s) => Number(s.qty) !== 0).map((s) => ({ at: s.location?.name ?? s.atVendor?.name ?? '?', qty: Number(s.qty) })),
      } : {}
    }
    case 'vendor': {
      const v = await db.vendor.findUnique({ where: { id: r.id }, include: { purchaseOrders: { where: { status: { in: ['DRAFT', 'SENT', 'PARTIALLY_RECEIVED'] } }, select: { poNumber: true, status: true, expectedAt: true } } } })
      return v ? { role: v.role, active: v.active, contact: v.contactName, email: v.email, leadTimeDays: v.leadTimeDays, openOrders: v.purchaseOrders.map((p) => ({ po: p.poNumber, status: p.status, expected: day(p.expectedAt) })) } : {}
    }
    case 'purchase order': {
      const p = await db.purchaseOrder.findUnique({ where: { id: r.id }, include: { vendor: true, lines: { orderBy: { id: 'asc' }, include: { component: { select: { name: true } }, productVariant: { include: { product: true, colorway: true } } } } } })
      return p ? {
        vendor: p.vendor.name, status: p.status, ordered: day(p.orderedAt), expected: day(p.expectedAt), received: day(p.receivedAt), paymentTerms: p.paymentTerms,
        lines: p.lines.map((l) => ({ item: l.component?.name ?? (l.productVariant ? [l.productVariant.product.name, l.productVariant.colorway?.customerName, l.productVariant.size].filter(Boolean).join(' / ') : l.description), ordered: Number(l.qtyOrdered), unit: l.unit, received: Number(l.qtyReceived), unitCostCents: l.unitCostCents })),
      } : {}
    }
    case 'production run': {
      const x = await db.productionRun.findUnique({ where: { id: r.id }, include: { product: true, vendor: true } })
      return x ? { product: x.product.name, maker: x.vendor?.name ?? null, status: x.status, expectedReady: day(x.expectedReadyAt), dateConfirmed: x.dateConfirmed, summary: x.statusSummary, runNotes: x.notes } : {}
    }
    case 'wholesale account': {
      const a = await db.wholesaleAccount.findUnique({ where: { id: r.id } })
      return a ? { type: a.type, active: a.active, contact: a.contactName, email: a.email, address: a.address, accountNotes: a.notes } : {}
    }
    default:
      return {}
  }
}

/**
 * open_record: one record named exactly, with all its current notes in full.
 * An ambiguous or unknown reference returns what it could be, and nothing is
 * chosen for the caller.
 */
export async function openRecord(ref: string): Promise<Record<string, unknown>> {
  const want = String(ref ?? '').trim()
  if (!want) return { found: false, reason: 'Say which record: a PO number, an id from your context, or its exact name.' }
  if (/^general$/i.test(want)) {
    const [notes, latest] = await Promise.all([
      db.note.findMany({ where: { entityId: null, supersededAt: null }, orderBy: { createdAt: 'desc' }, select: { id: true, entityType: true, entityId: true, content: true, createdAt: true } }),
      latestCounts(),
    ])
    return { found: true, record: { kind: 'general notes' }, notes: notes.map((n) => noteLine(n, latest)) }
  }
  const r = resolveRecord(want, await recordDirectory())
  if (r.status === 'none') return { found: false, reason: `Nothing is named exactly "${want}". Use the id shown in your context, or the exact name; query_status can search events and sales.` }
  if (r.status === 'ambiguous') return { found: false, ambiguous: true, candidates: r.candidates.map((c) => ({ kind: c.kind, id: c.id, name: c.name })), reason: 'More than one record has that name. Ask again with the id of the one you mean.' }
  const rec = r.record
  const keys = await noteKeysFor(rec)
  const fileKind = rec.kind === 'product' || rec.kind === 'component' || rec.kind === 'vendor' ? rec.kind : null
  const [notes, detail, latest, files] = await Promise.all([
    currentNotes(keys), detailFor(rec), latestCounts(),
    fileKind ? db.storedFileLink.findMany({ where: { kind: fileKind, recordId: rec.id }, select: { file: { select: { id: true, title: true } } } }) : [],
  ])
  return {
    found: true,
    record: { kind: rec.kind, id: rec.id, name: rec.name },
    detail,
    ...(files.length ? { files: files.map((f) => f.file), filesNote: 'Kept files linked to this record. read_file gives you one.' } : {}),
    notes: notes.map((n) => noteLine(n, latest)),
    notesNote: notes.length ? 'Every current note on this record, in full. Each starts with the id add_note\'s supersedes and retire_note take.' : 'No current notes on this record.',
  }
}

/**
 * The text that goes with a chat message naming records exactly, or null.
 * Never throws: a failed lookup leaves the message as it was.
 */
export async function prefetchForMessage(message: string): Promise<string | null> {
  try {
    const dir = await recordDirectory()
    const matches = mentionedRecords(message, dir)
    if (!matches.found.length && !matches.ambiguous.length) return null
    const notesBy = new Map<string, NoteRow[]>()
    await Promise.all(matches.found.map(async (r) => notesBy.set(`${r.kind}:${r.id}`, await currentNotes(await noteKeysFor(r)))))
    const latest = await latestCounts()
    return prefetchBlock(matches, (r) => notesBy.get(`${r.kind}:${r.id}`) ?? [], latest)
  } catch (e) {
    console.error('[prefetch] lookup failed', e)
    return null
  }
}
