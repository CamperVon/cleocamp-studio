import { db } from '@/lib/db'

/**
 * list_records: a capped, paginated list of one kind of open record, one line
 * each, for the transient-state layout (16 Oct 2026, review build), where the
 * lists are not printed. Never a whole catalogue section: at most
 * LIST_PAGE_ROWS lines and LIST_PAGE_CHARS characters a page, so a look-up
 * cannot rebuild the expensive prompt through a tool result (Codex review,
 * 16 Oct 2026). Detail of any one record is open_record. Read-only.
 */
export const LIST_KINDS = ['todos', 'questions', 'alerts', 'purchase orders', 'production runs', 'forecasts', 'calendar', 'notes', 'components', 'products', 'wholesale shipments'] as const
export type ListKind = (typeof LIST_KINDS)[number]
export const LIST_PAGE_ROWS = 20
export const LIST_PAGE_CHARS = 3_000

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : '—')
const one = (s: string | null | undefined, max: number) => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

/**
 * One page: rows matching the query (any case, anywhere in the line), at most
 * `rows` lines and `chars` characters, never a partial line. Pure.
 */
export function pageOf(lines: string[], o: { page?: number; query?: string | null; rows?: number; chars?: number }) {
  const q = (o.query ?? '').trim().toLowerCase()
  const all = q ? lines.filter((l) => l.toLowerCase().includes(q)) : lines
  const maxRows = o.rows ?? LIST_PAGE_ROWS
  const maxChars = o.chars ?? LIST_PAGE_CHARS
  // Pages are cut by both limits, in order, so every page is the same for the same list.
  const pages: string[][] = []
  let cur: string[] = []
  let size = 0
  for (const l of all) {
    if (cur.length && (cur.length >= maxRows || size + l.length + 1 > maxChars)) { pages.push(cur); cur = []; size = 0 }
    cur.push(l.length > maxChars ? `${l.slice(0, maxChars - 1)}…` : l)
    size += Math.min(l.length, maxChars) + 1
  }
  if (cur.length) pages.push(cur)
  const page = Math.min(Math.max(1, Math.trunc(o.page ?? 1)), Math.max(1, pages.length))
  return { total: all.length, page, pages: pages.length, rows: pages[page - 1] ?? [] }
}

async function linesFor(kind: ListKind): Promise<string[]> {
  switch (kind) {
    case 'todos':
    case 'questions': {
      const items = await db.actionItem.findMany({ where: { resolved: false, kind: kind === 'questions' ? 'QUESTION' : { not: 'QUESTION' } }, orderBy: { createdAt: 'asc' }, select: { id: true, kind: true, title: true, dueDate: true, urgent: true } })
      return items.map((i) => `[${i.id}] ${i.urgent ? 'URGENT ' : ''}${i.kind}${i.dueDate ? ` due ${day(i.dueDate)}` : ''}: ${one(i.title, 110)}`)
    }
    case 'alerts': {
      const a = await db.alert.findMany({ where: { resolved: false }, orderBy: { createdAt: 'desc' }, select: { id: true, severity: true, message: true } })
      return a.map((x) => `[${x.id}] ${x.severity}: ${one(x.message, 150)}`)
    }
    case 'purchase orders': {
      const p = await db.purchaseOrder.findMany({ where: { status: { in: ['DRAFT', 'SENT', 'PARTIALLY_RECEIVED'] } }, orderBy: [{ poNumber: 'asc' }, { id: 'asc' }], select: { poNumber: true, status: true, expectedAt: true, vendor: { select: { name: true } }, forProduct: { select: { name: true } }, _count: { select: { lines: true } } } })
      return p.map((x) => `PO ${x.poNumber} ${x.vendor.name}${x.forProduct ? ` for ${x.forProduct.name}` : ''} · ${x.status} · ${x._count.lines} lines · due ${x.expectedAt ? day(x.expectedAt) : 'no date'}`)
    }
    case 'production runs': {
      const r = await db.productionRun.findMany({ where: { status: { notIn: ['RECEIVED', 'CANCELLED'] } }, orderBy: [{ expectedReadyAt: 'asc' }, { id: 'asc' }], select: { id: true, status: true, expectedReadyAt: true, product: { select: { name: true } }, vendor: { select: { name: true } } } })
      return r.map((x) => `[${x.id}] ${x.product.name} at ${x.vendor?.name ?? 'no maker'} · ${x.status} · ready ${day(x.expectedReadyAt)}`)
    }
    case 'forecasts': {
      const f = await db.forecastResult.findMany({ orderBy: [{ recommendedOrderDate: 'asc' }, { id: 'asc' }], select: { recommendedOrderDate: true, blockedReason: true, note: true, product: { select: { name: true } }, component: { select: { name: true } } } })
      return f.map((x) => `${x.product?.name ?? x.component?.name ?? '?'}: ${x.blockedReason ? `BLOCKED, ${one(x.blockedReason, 90)}` : `${x.recommendedOrderDate ? `order by ${day(x.recommendedOrderDate)}. ` : ''}${one(x.note, 90)}`}`)
    }
    case 'calendar': {
      const e = await db.calendarEvent.findMany({ where: { date: { gte: new Date(Date.now() - 864e5), lte: new Date(Date.now() + 60 * 864e5) } }, orderBy: [{ date: 'asc' }, { id: 'asc' }], select: { id: true, date: true, title: true, type: true, source: true } })
      return e.map((x) => `${day(x.date)} ${one(x.title, 100)}${x.type === 'DELIVERY_EXPECTED' ? ' [PICKUP/DELIVERY]' : ''}${x.source === 'STUDIO_MOUSE' ? ` [${x.id}]` : ''}`)
    }
    case 'notes': {
      const [notes, products, components, vendors] = await Promise.all([
        db.note.findMany({ where: { supersededAt: null }, orderBy: { createdAt: 'desc' }, select: { id: true, entityId: true, entityType: true, content: true, createdAt: true } }),
        db.product.findMany({ select: { id: true, name: true } }),
        db.component.findMany({ select: { id: true, name: true } }),
        db.vendor.findMany({ select: { id: true, name: true } }),
      ])
      const name = new Map([...products, ...components, ...vendors].map((x) => [x.id, x.name]))
      return notes.map((n) => `[${n.id}] ${day(n.createdAt)} on ${n.entityId ? (name.get(n.entityId) ?? `${n.entityType.toLowerCase()} ${n.entityId}`) : 'general'}: ${one(n.content, 80)}`)
    }
    case 'components': {
      const c = await db.component.findMany({ where: { active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, onHandQty: true, unitOfMeasure: true, incomingQty: true, locationStock: { select: { qty: true, location: { select: { name: true } }, atVendor: { select: { name: true } } } } } })
      return c.map((x) => {
        const places = x.locationStock.filter((s) => Number(s.qty) !== 0).map((s) => `${Number(s.qty)} ${s.location?.name ?? s.atVendor?.name ?? '?'}`)
        return `${x.name} [${x.id}] · ${Number(x.onHandQty)} ${x.unitOfMeasure}${places.length ? ` (${places.join(', ')})` : ''}${Number(x.incomingQty) > 0 ? ` · ${Number(x.incomingQty)} incoming` : ''}`
      })
    }
    case 'products': {
      const p = await db.product.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, status: true, retailPriceCents: true, _count: { select: { variants: true } } } })
      return p.map((x) => `${x.name} [${x.id}] · ${x.status.toLowerCase()} · retail ${x.retailPriceCents == null ? 'unknown' : `$${(x.retailPriceCents / 100).toFixed(2)}`} · ${x._count.variants} variants`)
    }
    case 'wholesale shipments': {
      const s = await db.wholesaleShipment.findMany({ orderBy: [{ sentAt: 'desc' }, { id: 'asc' }], select: { id: true, sentAt: true, paid: true, account: { select: { name: true } }, lines: { select: { wholesaleCents: true } } } })
      return s.map((x) => `[${x.id}] ${x.account.name} · sent ${day(x.sentAt)} · ${x.lines.length} lines · $${(x.lines.reduce((n, l) => n + (l.wholesaleCents ?? 0), 0) / 100).toFixed(2)} · ${x.paid === true ? 'paid' : x.paid === false ? 'UNPAID' : 'payment not confirmed'}`)
    }
  }
}

export async function listRecords(kind: string, o: { query?: string | null; page?: number } = {}) {
  if (!(LIST_KINDS as readonly string[]).includes(kind)) return { ok: false, reason: `No such list. One of: ${LIST_KINDS.join(', ')}.` }
  const p = pageOf(await linesFor(kind as ListKind), o)
  return {
    ok: true, kind, query: o.query ?? null, total: p.total, page: p.page, pages: p.pages, rows: p.rows,
    note: p.pages > p.page ? `Page ${p.page} of ${p.pages}. Ask for page ${p.page + 1}, or narrow with query.` : 'That is all of them.',
  }
}
