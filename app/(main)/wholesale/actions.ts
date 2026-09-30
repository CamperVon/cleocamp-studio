'use server'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { currentPersonId } from '@/lib/session'
import { asPerson } from '@/lib/mouse/actor'
import { TOOLS } from '@/lib/mouse/tools'

/**
 * The line sheet by hand. Brandon, 30 Sept 2026: "Can we click on items to
 * edit or remove." Every change goes through update_line_sheet, the tool
 * Mouse uses, so the rules are the same either way: a row with a product
 * takes its prices from the price list and Shopify and cannot be given its
 * own. Only someone signed in from their own link.
 */
type Result = { ok: true } | { ok: false; error: string }

async function person() {
  const id = await currentPersonId()
  if (!id) return null
  return db.person.findFirst({ where: { id, active: true, external: false }, select: { id: true } })
}

async function run(input: Record<string, unknown>): Promise<Result> {
  const who = await person()
  if (!who) return { ok: false, error: 'Open the app from your own link so this carries your name.' }
  const r = (await asPerson(who.id, () => TOOLS.update_line_sheet.run(input))) as Record<string, unknown>
  revalidatePath('/wholesale')
  return r.saved === false ? { ok: false, error: String(r.reason ?? 'That did not save.') } : { ok: true }
}

export type RowEdit = {
  item: string; colorLabel: string; description: string; sizing: string; minOrder: string
  commission: string; availability: string
  /** Only for a row with no product. Dollars as typed, "94" or "$94.50". */
  wholesale?: string
  msrp?: string
}

export async function editLineSheetRow(rowId: string, e: RowEdit): Promise<Result> {
  if (!e.item.trim()) return { ok: false, error: 'The item needs a name.' }
  const input: Record<string, unknown> = {
    action: 'edit', rowId,
    item: e.item, colorLabel: e.colorLabel, description: e.description, sizing: e.sizing,
    minOrder: e.minOrder, commission: e.commission, availability: e.availability,
  }
  if (e.wholesale !== undefined) {
    const d = Number(e.wholesale.replace(/[$,\s]/g, ''))
    if (!e.wholesale.trim() || !Number.isFinite(d) || d <= 0) return { ok: false, error: 'Wholesale needs a price, like 94.' }
    input.wholesaleCents = Math.round(d * 100)
  }
  if (e.msrp !== undefined) input.msrp = e.msrp
  return run(input)
}

export async function removeLineSheetRow(rowId: string): Promise<Result> {
  return run({ action: 'remove', rowId })
}

export async function restoreLineSheetRow(rowId: string): Promise<Result> {
  return run({ action: 'restore', rowId })
}

/**
 * An invoice charged a product off the price list, and it was a deal for that
 * order only (Brandon, 30 Sept 2026, on Grandpa's Boy Belts: "that was a
 * special deal one time only"). Saved as a Note so the Wholesale page stops
 * flagging it and Mouse knows not to offer that price again as a matter of
 * course.
 */
export async function markPriceOneOff(input: { key: string; product: string; charged: string; account: string; invoice: string | null; list: string }): Promise<Result> {
  const id = await currentPersonId()
  const who = id ? await db.person.findFirst({ where: { id, active: true, external: false }, select: { name: true } }) : null
  if (!who) return { ok: false, error: 'Open the app from your own link so this carries your name.' }
  if (!input.key.startsWith('oneoff-price:')) return { ok: false, error: 'Not a price to mark.' }
  if (await db.note.findFirst({ where: { entityId: input.key }, select: { id: true } })) { revalidatePath('/wholesale'); return { ok: true } }
  const day = new Date().toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric' })
  await db.note.create({
    data: {
      entityType: 'GENERAL', entityId: input.key, source: 'MANUAL',
      content: `One-time price: ${input.product} at ${input.charged} to ${input.account}${input.invoice ? ` on ${input.invoice}` : ''} was a special deal for that order only. The wholesale price stays ${input.list}; do not offer the deal again unless told to. (${who.name.split(' ')[0]}, ${day})`,
    },
  })
  revalidatePath('/wholesale')
  return { ok: true }
}

/**
 * A wholesale price by hand. Brandon, 30 Sept 2026: "We need to be able to
 * update the wholesale price manually as well." Goes through
 * set_wholesale_price, as telling Mouse does: the standing price for the
 * whole product, or for the given variants only where they are priced apart
 * (Bean Bag Silver). Never a price for one invoice; that is named on the
 * invoice.
 */
export async function setWholesalePrice(input: { productId: string; variantIds?: string[]; dollars: string }): Promise<Result> {
  const who = await person()
  if (!who) return { ok: false, error: 'Open the app from your own link so this carries your name.' }
  const price = Number(input.dollars.replace(/[$,\s]/g, ''))
  if (!input.dollars.trim() || !Number.isFinite(price) || price <= 0) return { ok: false, error: 'Type a price, like 54.' }
  const calls = input.variantIds?.length
    ? input.variantIds.map((productVariantId) => ({ productId: input.productId, productVariantId, price }))
    : [{ productId: input.productId, price }]
  for (const c of calls) {
    const r = (await asPerson(who.id, () => TOOLS.set_wholesale_price.run(c))) as Record<string, unknown>
    if (r.saved === false) { revalidatePath('/wholesale'); return { ok: false, error: String(r.reason ?? 'That did not save.') } }
  }
  revalidatePath('/wholesale')
  return { ok: true }
}
