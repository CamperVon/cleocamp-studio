import { db } from '@/lib/db'

/**
 * Products sold as a kit of other products (KitPart, 8 Oct 2026): a Bateau
 * Bag is a Bateau Body plus a Bateau Handle in the bag's colour. Each part
 * has its own Shopify count, so a bag can only be made up while both are on
 * hand: its availability is the lower of the two. Read only: nothing here
 * moves stock or touches Shopify.
 */

export type KitVariantCount = { colour: string | null; colourCode: string | null; onHand: number | null }
export type KitPartIn = { name: string; qty: number; matchColour: boolean; variants: KitVariantCount[] }
export type KitLine = { colour: string | null; available: number | null; parts: Array<{ name: string; onHand: number | null; problem?: string }> }

const same = (a: KitVariantCount, b: { colour: string | null; colourCode: string | null }) =>
  (a.colourCode && b.colourCode ? a.colourCode === b.colourCode : (a.colour ?? '').toLowerCase() === (b.colour ?? '').toLowerCase())

/**
 * For each of the kit's own variants (one per colour), how many can be made
 * up from the parts: the lowest of each part's count divided by how many the
 * kit takes. Unknown when any part's count is unknown or its variant cannot
 * be told apart. Pure.
 */
export function kitAvailability(kitVariants: Array<{ colour: string | null; colourCode: string | null }>, parts: KitPartIn[]): KitLine[] {
  return kitVariants.map((kv) => {
    const got = parts.map((p) => {
      const pick = p.matchColour ? p.variants.filter((v) => same(v, kv)) : p.variants
      if (pick.length !== 1) {
        return { name: p.name, onHand: null, per: null, problem: pick.length ? `${pick.length} variants could be it` : p.matchColour ? `no ${kv.colour ?? 'matching'} one` : 'no variant' }
      }
      const n = pick[0].onHand
      return { name: p.name, onHand: n, per: n === null ? null : Math.floor(n / Math.max(1, p.qty)) }
    })
    const available = got.some((g) => g.per === null) ? null : Math.max(0, Math.min(...got.map((g) => g.per!)))
    return { colour: kv.colour, available, parts: got.map(({ name, onHand, problem }) => ({ name, onHand, ...(problem ? { problem } : {}) })) }
  })
}

/** Every kit product's availability by colour, keyed by product id. */
export async function kitsByProduct(): Promise<Map<string, { parts: string[]; lines: KitLine[]; shared: string[] }>> {
  const kits = await db.kitPart.findMany({
    include: {
      parent: { select: { id: true, variants: { select: { colorCode: true, colorway: { select: { customerName: true, colorCode: true } } } } } },
      part: { select: { name: true, variants: { select: { onHandQty: true, colorCode: true, colorway: { select: { customerName: true, colorCode: true } } } } } },
    },
    orderBy: { createdAt: 'asc' },
  })
  const byParent = new Map<string, typeof kits>()
  for (const k of kits) byParent.set(k.parentId, [...(byParent.get(k.parentId) ?? []), k])
  const out = new Map<string, { parts: string[]; lines: KitLine[]; shared: string[] }>()
  for (const [parentId, ks] of byParent) {
    const kitVariants = ks[0].parent.variants.map((v) => ({ colour: v.colorway?.customerName ?? null, colourCode: v.colorCode ?? v.colorway?.colorCode ?? null }))
    const parts: KitPartIn[] = ks.map((k) => ({
      name: k.part.name, qty: k.qty, matchColour: k.matchColour,
      variants: k.part.variants.map((v) => ({ colour: v.colorway?.customerName ?? null, colourCode: v.colorCode ?? v.colorway?.colorCode ?? null, onHand: v.onHandQty === null ? null : Number(v.onHandQty) })),
    }))
    // A part every colour draws on (the body) is one pool: the per-colour
    // figures are each "up to", and together they cannot exceed it.
    const shared = parts.filter((p) => !p.matchColour && p.variants.length === 1).map((p) => {
      const n = p.variants[0].onHand
      return `the ${n ?? 'unknown number of'} ${p.name} on hand ${n === 1 ? 'is' : 'are'} shared by every colour, so ${n ?? 'that many'} in all at most`
    })
    out.set(parentId, { parts: ks.map((k) => `${k.qty > 1 ? `${k.qty} × ` : ''}${k.part.name}${k.matchColour ? ' (same colour)' : ''}`), lines: kitAvailability(kitVariants, parts), shared })
  }
  return out
}
