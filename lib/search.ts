import { db } from '@/lib/db'

/**
 * One search box for the whole app (Brandon, 6 Oct 2026: "a search button
 * next to More, so we can search a name or whatever and get directed to the
 * closest hit"). Code only, no model: it finds rows by their names and sends
 * you to the page that lists them, opened at that row (app/ui/jump.tsx).
 *
 * "Closest" is ranked here, not guessed: an exact name beats a name that
 * starts with what was typed, which beats a word that does, which beats the
 * letters appearing anywhere, which beats a near miss of a letter or two
 * ("Lorna" still finds Lorena).
 */

export type SearchHit = { kind: string; label: string; sub: string | null; href: string; score: number }

type Candidate = { kind: string; label: string; sub?: string | null; href: string; also?: Array<string | null | undefined>; exact?: boolean }

/** Lower case, accents off, punctuation to spaces. Pure. */
export function norm(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9@.]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Edit distance, stopping early past the limit. Pure. */
export function distance(a: string, b: string, limit = 3): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      best = Math.min(best, cur[j])
    }
    if (best > limit) return limit + 1
    prev = cur
  }
  return prev[b.length]
}

/** How well one text answers the query, 0 for not at all. Pure. */
export function scoreText(query: string, text: string | null | undefined): number {
  const q = norm(query)
  const t = norm(text ?? '')
  if (!q || !t) return 0
  if (t === q) return 100
  if (t.startsWith(q)) return 90
  const words = t.split(' ')
  if (words.some((w) => w.startsWith(q))) return 80
  const qs = q.split(' ')
  if (qs.length > 1 && qs.every((x) => words.some((w) => w.startsWith(x)))) return 75
  if (t.includes(q)) return 70
  // A near miss: one letter off in a short word, two in a long one. Never
  // for numbers: 2390 is not a near miss of PO 2391, it is another order.
  const allowed = /^[\d ]+$/.test(q) ? 0 : q.length >= 7 ? 2 : q.length >= 4 ? 1 : 0
  if (allowed) {
    const near = Math.min(distance(q, t, allowed), ...words.map((w) => distance(q, w, allowed)),
      ...words.map((w) => distance(q, w.slice(0, q.length), allowed)))
    if (near <= allowed) return 55 - near * 5
  }
  return 0
}

const KIND_ORDER = ['Product', 'Vendor', 'Component', 'Purchase order', 'File', 'Wholesale', 'Stylist', 'Cleo Crew', 'Friend of the Brand', 'To-do', 'Question', 'Support', 'Customer']

/** The best hits first, at most `limit`. A record's other names (a legal name, an email) count a little less than its own. Pure. */
export function rankHits(query: string, candidates: Candidate[], limit = 8): SearchHit[] {
  const hits: SearchHit[] = []
  for (const c of candidates) {
    const own = scoreText(query, c.label)
    const other = Math.max(0, ...(c.also ?? []).map((a) => scoreText(query, a) - 5))
    const score = c.exact ? 100 : Math.max(own, other)
    if (score > 0) hits.push({ kind: c.kind, label: c.label, sub: c.sub ?? null, href: c.href, score })
  }
  // Equally close: the studio's own records before the thousands of customers.
  const rank = (k: string) => { const i = KIND_ORDER.indexOf(k); return i < 0 ? KIND_ORDER.length : i }
  return hits.sort((a, b) => b.score - a.score || rank(a.kind) - rank(b.kind) || a.label.length - b.label.length || a.label.localeCompare(b.label)).slice(0, limit)
}

/** A PO number typed as "2391", "PO 2391" or "#2391". Pure. */
export function poNumberIn(query: string): string | null {
  const m = query.trim().match(/^(?:po\s*)?#?\s*(\d{3,6})$/i)
  return m ? m[1] : null
}

const at = (page: string, id: string) => `${page}#rec-${id}`

/** Everything the search box can find, ranked. Read-only. */
export async function searchEverything(query: string): Promise<SearchHit[]> {
  const q = query.trim().slice(0, 80)
  if (q.length < 2) return []
  // Big tables are narrowed by the database first; small ones are read whole
  // so a typo can still find them.
  const words = norm(q).split(' ').filter((w) => w.length >= 2)
  const like = (field: string) => ({ OR: words.map((w) => ({ [field]: { contains: w, mode: 'insensitive' as const } })) })
  const [products, components, vendors, pos, accounts, stylists, contacts, customers, cases, files, items] = await Promise.all([
    db.product.findMany({ select: { id: true, name: true, status: true } }),
    db.component.findMany({ where: { active: true }, select: { id: true, name: true, vendorSku: true, vendor: { select: { name: true } } } }),
    db.vendor.findMany({ select: { id: true, name: true, legalName: true, contactName: true, email: true } }),
    db.purchaseOrder.findMany({ select: { poNumber: true, status: true, vendor: { select: { name: true } } } }),
    db.wholesaleAccount.findMany({ select: { id: true, name: true, contactName: true, email: true } }),
    db.stylist.findMany({ select: { id: true, name: true, email: true, instagram: true } }),
    db.contact.findMany({ where: { removedAt: null }, select: { id: true, name: true, role: true, email: true, circle: true } }),
    words.length ? db.customer.findMany({ where: { excluded: false, OR: [like('name'), like('email')] }, select: { id: true, name: true, email: true }, take: 50 }) : [],
    words.length ? db.supportCase.findMany({
      where: {
        AND: [
          { OR: [like('customerName'), like('customerEmail'), like('subject')] },
          { OR: [{ status: { not: 'RESOLVED' } }, { resolvedAt: { gte: new Date(Date.now() - 14 * 864e5) }, category: { not: 'SPAM' } }, { reviewRequestedAt: { not: null }, reviewedAt: null }] },
        ],
      },
      select: { id: true, customerName: true, customerEmail: true, subject: true },
      take: 50,
    }) : [],
    db.storedFile.findMany({ select: { id: true, title: true, filename: true } }),
    words.length ? db.actionItem.findMany({ where: { resolved: false, ...like('title') }, select: { id: true, title: true, kind: true }, take: 50 }) : [],
  ])
  const po = poNumberIn(q)
  const candidates: Candidate[] = [
    ...pos.map((p) => ({
      kind: 'Purchase order', label: `PO ${p.poNumber} · ${p.vendor.name}`, sub: p.status.replace(/_/g, ' ').toLowerCase(), href: `/po/${p.poNumber}`,
      also: [`PO ${p.poNumber}`], exact: po === p.poNumber,
    })),
    ...products.map((p) => ({ kind: 'Product', label: p.name, sub: p.status.toLowerCase(), href: at('/products', p.id) })),
    ...components.map((c) => ({ kind: 'Component', label: c.name, sub: c.vendor?.name ?? null, href: at('/components', c.id), also: [c.vendorSku] })),
    ...vendors.map((v) => ({ kind: 'Vendor', label: v.name, sub: v.legalName ?? v.contactName, href: at('/vendors', v.id), also: [v.legalName, v.contactName, v.email] })),
    ...accounts.map((a) => ({ kind: 'Wholesale', label: a.name, sub: a.contactName, href: at('/wholesale', a.id), also: [a.contactName, a.email] })),
    ...stylists.map((s) => ({ kind: 'Stylist', label: s.name, sub: s.instagram, href: at('/stylists', s.id), also: [s.email, s.instagram] })),
    ...contacts.map((c) => ({
      kind: c.circle === 'FRIEND_OF_BRAND' ? 'Friend of the Brand' : 'Cleo Crew', label: c.name, sub: c.role,
      href: at(c.circle === 'FRIEND_OF_BRAND' ? '/friends' : '/crew', c.id), also: [c.email],
    })),
    ...customers.map((c) => ({ kind: 'Customer', label: c.name, sub: c.email, href: at('/customers', c.id), also: [c.email] })),
    ...cases.map((c) => ({ kind: 'Support', label: c.customerName ?? c.customerEmail, sub: c.subject, href: at('/support', c.id), also: [c.customerEmail, c.subject] })),
    ...files.map((f) => ({ kind: 'File', label: f.title, sub: f.filename, href: `/files#rec-${f.id}`, also: [f.filename] })),
    ...items.map((i) => ({ kind: i.kind === 'TODO' ? 'To-do' : 'Question', label: i.title, href: at('/items', i.id) })),
  ]
  return rankHits(q, candidates)
}
