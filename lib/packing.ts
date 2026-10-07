import { db } from '@/lib/db'

/**
 * Shipping supplies used up by web orders, deducted from the studio's stock
 * every night (Brandon, 7 Oct 2026: "Mouse should be making some logical
 * deductions about shipping supplies ... so it can alert us well in advance
 * when we might need new mailers or supplies"). Until then every supply sat at
 * Jane's 24 Sept count as if nothing had shipped since.
 *
 * The rules are Brandon's, 7 Oct 2026. Per package shipped (one Shopify
 * fulfilment; an order sent in two parts is two packages):
 *   - each Cleo Bag: one shipping box and two sheets of newsprint;
 *   - each Bean Bag: one Kraft mailer and one sheet of newsprint;
 *   - everything else in the order, together: 1-3 items in one Kraft mailer,
 *     4-5 in one large envelope, 6 or more in one shipping box;
 *   - one Moo postcard, and a 25th of a roll of tape.
 * Tees are already in glassine from Antonio's, packed there, so glassine is
 * never deducted here; nor is newsprint for tees (it is not used with them).
 *
 * Every figure is an estimate from Shopify's shipped orders and is said to be
 * one. A count by a person is the last word: deductions only ever cover days
 * after the latest count of that supply.
 */

export type PackKey = 'mailer' | 'envelope' | 'box' | 'newsprint' | 'postcard' | 'tape'

/** Which component each supply is (ids are stable; names can change). */
export const PACK_COMPONENTS: Record<PackKey, string> = {
  mailer: 'cmtxppucx00006d9qyn1v863w', // Kraft Recyclable Paper Mailers #5
  envelope: 'cmp_envelopes', // Large envelopes
  box: 'cmtxa0ot5000s04idk6zv9n3a', // Shipping boxes (The Boxery)
  newsprint: 'cmtxmev64000s04l3zi7kyg75', // Newsprint (kraft paper) sheets
  postcard: 'cmux15jnk00001k7duttd5c9z', // Postcards (Moo)
  tape: 'cmug8pfko00000c7dvyf9nino', // Shipping tape, in rolls
}

export const RULES = { mailerMaxItems: 3, envelopeMaxItems: 5, ordersPerTapeRoll: 25 }

export type PackItem = { product: string; quantity: number }
export type PackUse = Record<PackKey, number>

const none = (): PackUse => ({ mailer: 0, envelope: 0, box: 0, newsprint: 0, postcard: 0, tape: 0 })

/** What one order uses. Pure. */
export function packingFor(items: PackItem[]): PackUse {
  const use = none()
  let loose = 0
  for (const i of items) {
    if (i.quantity <= 0) continue
    if (/^cleo bag\b/i.test(i.product)) { use.box += i.quantity; use.newsprint += 2 * i.quantity }
    else if (/^bean bag\b/i.test(i.product)) { use.mailer += i.quantity; use.newsprint += i.quantity }
    else loose += i.quantity
  }
  if (loose > 0) {
    if (loose <= RULES.mailerMaxItems) use.mailer += 1
    else if (loose <= RULES.envelopeMaxItems) use.envelope += 1
    else use.box += 1
  }
  if (items.some((i) => i.quantity > 0)) {
    use.postcard += 1
    use.tape += 1 / RULES.ordersPerTapeRoll
  }
  return use
}

/** Many orders' use added up. Pure. */
export function packingForOrders(orders: Array<{ items: PackItem[] }>): PackUse {
  const total = none()
  for (const o of orders) {
    const u = packingFor(o.items)
    for (const k of Object.keys(total) as PackKey[]) total[k] += u[k]
  }
  return total
}

export const PACKING_NOTE = 'Packing use for '

/** The LA calendar date (YYYY-MM-DD) of a moment. Pure. */
export function laDay(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

/** The day a packing-use note is for, or null. Pure. */
export function packingDay(note: string | null | undefined): string | null {
  const m = new RegExp(`^${PACKING_NOTE}(\\d{4}-\\d{2}-\\d{2})`).exec(note ?? '')
  return m ? m[1] : null
}

/** Days strictly after `from` up to and including `to`, as YYYY-MM-DD. Pure. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = []
  const d = new Date(from + 'T12:00:00Z')
  for (;;) {
    d.setUTCDate(d.getUTCDate() + 1)
    const s = d.toISOString().slice(0, 10)
    if (s > to) break
    out.push(s)
  }
  return out
}

/**
 * Deduct what shipped, for each supply, on every finished LA day since its
 * last count or last deduction, whichever is later. Yesterday is the last day
 * done, so a day is never counted half-way through. Safe to run twice.
 */
export async function deductPacking(opts: { dryRun?: boolean; maxDays?: number } = {}): Promise<{ days: string[]; written: string[]; orders: number; skipped?: string }> {
  const { fetchShippedOrders } = await import('@/lib/integrations/shopify')
  const { writeEvent } = await import('@/lib/mouse/tools')
  const yesterday = laDay(new Date(Date.now() - 864e5))

  // Where each supply was last counted or last deducted.
  const since = new Map<PackKey, string>()
  for (const k of Object.keys(PACK_COMPONENTS) as PackKey[]) {
    const id = PACK_COMPONENTS[k]
    const [count, last] = await Promise.all([
      db.inventoryEvent.findFirst({ where: { componentId: id, type: 'COUNTED' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
      db.inventoryEvent.findFirst({ where: { componentId: id, type: 'USED', note: { startsWith: PACKING_NOTE } }, orderBy: { createdAt: 'desc' }, select: { note: true } }),
    ])
    if (!count) continue // never counted: nothing to deduct from
    const counted = laDay(count.createdAt)
    const deducted = packingDay(last?.note)
    since.set(k, deducted && deducted > counted ? deducted : counted)
  }
  if (!since.size) return { days: [], written: [], orders: 0, skipped: 'no supply has been counted' }

  const earliest = [...since.values()].sort()[0]
  const days = daysBetween(earliest, yesterday).slice(-(opts.maxDays ?? 45))
  if (!days.length) return { days: [], written: [], orders: 0 }

  const orders = await fetchShippedOrders(days[0])
  const variants = await db.productVariant.findMany({ where: { shopifyVariantId: { not: null } }, select: { shopifyVariantId: true, product: { select: { name: true } } } })
  const productOf = new Map(variants.map((v) => [v.shopifyVariantId!, v.product.name]))

  const written: string[] = []
  let counted = 0
  for (const day of days) {
    const today = orders.filter((o) => o.shippedOn === day)
    if (!today.length) continue
    counted += today.length
    const use = packingForOrders(today.map((o) => ({
      items: o.items.map((i) => ({ product: productOf.get(i.variantId.split('/').pop()!) ?? i.title, quantity: i.quantity })),
    })))
    for (const k of Object.keys(use) as PackKey[]) {
      const qty = Math.round(use[k] * 1000) / 1000
      if (!qty || !since.has(k) || day <= since.get(k)!) continue
      const note = `${PACKING_NOTE}${day}: ${today.length} package${today.length === 1 ? '' : 's'} shipped. An estimate from Shopify's shipped orders and the packing rules, not a count.`
      written.push(`${day} ${k} −${qty}`)
      if (!opts.dryRun) {
        const r = await writeEvent({ componentId: PACK_COMPONENTS[k], deltaQty: -qty, type: 'USED', note, source: 'SYSTEM' }) as { error?: string }
        if (r?.error) throw new Error(`Packing ${k} ${day}: ${r.error}`)
      }
    }
  }
  return { days, written, orders: counted }
}

/**
 * Supplies used a day, from the last 28 days of deductions, for the forecast.
 * Taken from the day each deduction is FOR, not when it was written, since a
 * catch-up writes several days at once.
 */
export async function packingRates(days = 28): Promise<Map<string, number>> {
  const from = laDay(new Date(Date.now() - days * 864e5))
  const evs = await db.inventoryEvent.findMany({
    where: { type: 'USED', note: { startsWith: PACKING_NOTE }, componentId: { in: Object.values(PACK_COMPONENTS) } },
    select: { componentId: true, deltaQty: true, note: true },
  })
  const used = new Map<string, number>()
  for (const e of evs) {
    const d = packingDay(e.note)
    if (!d || d < from || !e.componentId) continue
    used.set(e.componentId, (used.get(e.componentId) ?? 0) + Math.abs(Number(e.deltaQty)))
  }
  return new Map([...used].map(([id, n]) => [id, n / days]))
}
