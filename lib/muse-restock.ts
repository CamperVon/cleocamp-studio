import { db } from '@/lib/db'
import { PACK_COMPONENTS, packingRates } from '@/lib/packing'

/**
 * Supplies Muse buys by itself when they run low (Brandon, 26 Oct 2026:
 * "mouse needs to act on its own, muse will ask for approval on the buying
 * end"). Every night, after packing use comes off stock, a supply on this
 * list with under two weeks left is handed to Muse with its spec. Nobody has
 * to ask. Muse then asks the team to approve the item, price and quantity
 * before it buys; that question always goes to a person (buyNeedsTeam in
 * lib/muse.ts), never to the answerer.
 *
 * Until 26 Oct the rule lived only in a note, and nothing read it: shipping
 * tape sat below zero for weeks and no task was ever handed over.
 */

/** Simple supplies Muse may buy, each with the spec a person gave. */
export const MUSE_BUYS: Array<{ componentId: string; name: string; unit: string; spec: string; source: string }> = [
  {
    componentId: PACK_COMPONENTS.tape,
    name: 'Shipping tape',
    unit: 'rolls',
    spec: 'Cheap, clear packing tape, any brand.',
    source: 'Brandon, 25 Oct 2026',
  },
]

/** Days of cover that start a hand-off (Brandon, 26 Oct 2026: about two weeks). */
export const RESTOCK_DAYS = 14
/** A hand-off within this many days counts as still in hand: no second task. */
export const RESTOCK_QUIET_DAYS = 21
/** Every Muse task this makes starts with this, so its buying questions go to the team. */
export const BUY_PREFIX = 'Buy: '

export type RestockCall =
  | { action: 'hand'; daysLeft: number }
  | { action: 'count'; why: string }
  | { action: 'none'; why: string }

/**
 * What to do about one supply tonight. Pure. A count below zero is wrong
 * (a delivery never logged), so it asks for a count instead of buying on it.
 */
export function restockCall(onHand: number | null, perDay: number | null, handedRecently: boolean): RestockCall {
  if (onHand === null) return { action: 'count', why: 'never counted' }
  if (onHand < 0) return { action: 'count', why: `reads ${onHand}, below zero` }
  if (!perDay || perDay <= 0) return { action: 'none', why: 'no use recorded' }
  const daysLeft = onHand / perDay
  if (daysLeft >= RESTOCK_DAYS) return { action: 'none', why: `${Math.round(daysLeft)} days left` }
  if (handedRecently) return { action: 'none', why: 'already with Muse' }
  return { action: 'hand', daysLeft }
}

/** The brief Muse gets. It leaves the company: supply facts and the ship-to only. Pure. */
export function restockBrief(s: { name: string; unit: string; spec: string }, onHand: number, perDay: number, shipTo: string | null): string {
  const week = Math.round(perDay * 7 * 10) / 10
  return [
    `PURCHASE: ${s.name.toLowerCase()} for our studio in Los Angeles.`,
    '',
    `What: ${s.spec}`,
    `How fast we use it: about ${week} ${s.unit} a week. About ${Math.max(0, Math.floor(onHand))} ${s.unit} left, so roughly ${Math.round(onHand / perDay)} days.`,
    shipTo ? `Ship to: ${shipTo}` : 'Ship to: ask us for the address when you ask for approval.',
    '',
    'Before you buy anything, ask us through your questions: the item and link, the price per unit, how many you suggest, the total with shipping and tax, and when it would arrive. Buy only after one of us says yes, and only what we approved.',
    'When it is bought, post a short report with what you bought, the total and the expected delivery date.',
  ].join('\n')
}

/** Hand each low supply on MUSE_BUYS to Muse. Nightly; dryRun writes nothing. */
export async function restockWithMuse(opts: { dryRun?: boolean } = {}): Promise<{ handed: string[]; askedToCount: string[]; fine: string[] }> {
  const out = { handed: [] as string[], askedToCount: [] as string[], fine: [] as string[] }
  const ids = MUSE_BUYS.map((s) => s.componentId)
  const since = new Date(Date.now() - RESTOCK_QUIET_DAYS * 864e5)
  const [components, rates, recent, studio] = await Promise.all([
    db.component.findMany({ where: { id: { in: ids } }, select: { id: true, onHandQty: true } }),
    packingRates(),
    db.museTask.findMany({ where: { OR: [{ status: 'OPEN' }, { createdAt: { gte: since } }] }, select: { records: true, status: true } }),
    db.location.findFirst({ where: { isDefault: true }, select: { address: true } }),
  ])
  for (const s of MUSE_BUYS) {
    const c = components.find((x) => x.id === s.componentId)
    if (!c) { out.fine.push(`${s.name}: not in the app`); continue }
    const counted = await db.inventoryEvent.count({ where: { componentId: c.id, type: 'COUNTED' } })
    const onHand = counted ? Number(c.onHandQty) : null
    const perDay = rates.get(c.id) ?? null
    const handedRecently = recent.some((t) => t.status !== 'CANCELLED' && ((Array.isArray(t.records) ? t.records : []) as Array<{ id?: string }>).some((r) => r?.id === c.id))
    const call = restockCall(onHand, perDay, handedRecently)
    if (call.action === 'none') { out.fine.push(`${s.name}: ${call.why}`); continue }
    if (call.action === 'count') {
      const title = `Count the ${s.name.toLowerCase()}`
      const open = await db.actionItem.findFirst({ where: { title, resolved: false }, select: { id: true } })
      if (!open && !opts.dryRun) {
        await db.actionItem.create({
          data: {
            kind: 'TODO' as never, source: 'SYSTEM' as never, title,
            detail: `The app's count of ${s.name.toLowerCase()} ${call.why}, so Mouse can't tell when to have Muse buy more. Usually a delivery that was never logged. Tell Mouse how many ${s.unit} are on the shelf.`,
          },
        })
      }
      out.askedToCount.push(`${s.name}: ${call.why}`)
      continue
    }
    if (!opts.dryRun) {
      await db.museTask.create({
        data: {
          title: `${BUY_PREFIX}${s.name.toLowerCase()} (${s.spec.replace(/\.$/, '').toLowerCase()})`.slice(0, 160),
          brief: restockBrief(s, onHand!, perDay!, studio?.address ?? null),
          records: [{ kind: 'component', id: c.id }] as never,
          fileIds: [],
          requestedById: null,
        },
      })
    }
    out.handed.push(`${s.name}: ${Math.round(call.daysLeft)} days left`)
  }
  return out
}
