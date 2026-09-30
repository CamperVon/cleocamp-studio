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
