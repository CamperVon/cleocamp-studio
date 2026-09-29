'use server'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { currentPersonId } from '@/lib/session'
import { asPerson } from '@/lib/mouse/actor'
import { TOOLS } from '@/lib/mouse/tools'

/**
 * The Stylists page by hand. Brandon, 29 Sept 2026: "We want to have a manual
 * entry and also a place for anyone on studio to leave notes ... We also need
 * to be able to click closed or items returns."
 *
 * Every change goes through the same tool Mouse uses (lib/mouse/tools.ts), so
 * a pull entered here takes stock out exactly as one told to Mouse does, and
 * a return puts it back. Only someone signed in from their own link, so each
 * entry carries a name.
 */
type Result = { ok: true; message?: string } | { ok: false; error: string }

async function person() {
  const id = await currentPersonId()
  if (!id) return null
  return db.person.findFirst({ where: { id, active: true, external: false }, select: { id: true, name: true } })
}

const NO_NAME: Result = { ok: false, error: 'Open the app from your own link so this carries your name.' }

async function run(name: string, input: Record<string, unknown>, who: { id: string }) {
  const r = (await asPerson(who.id, () => TOOLS[name].run(input))) as Record<string, unknown>
  revalidatePath('/stylists')
  return r
}

const failed = (r: Record<string, unknown>) => r.saved === false ? String(r.reason ?? 'That did not save.') : null

export async function addStylist(input: { name: string; email?: string; company?: string; phone?: string; instagram?: string }): Promise<Result> {
  const who = await person()
  if (!who) return NO_NAME
  if (!input.name?.trim()) return { ok: false, error: 'A stylist needs a name.' }
  const r = await run('save_stylist', input, who)
  return failed(r) ? { ok: false, error: failed(r)! } : { ok: true }
}

export async function addRequest(input: { stylistId: string; what: string; neededBy?: string }): Promise<Result> {
  const who = await person()
  if (!who) return NO_NAME
  if (!input.what?.trim()) return { ok: false, error: 'Say what they asked for.' }
  const r = await run('record_stylist_request', { ...input, neededBy: input.neededBy || undefined }, who)
  return failed(r) ? { ok: false, error: failed(r)! } : { ok: true }
}

export async function addPull(input: { stylistId: string; project?: string; dueBackAt?: string; items: Array<{ productVariantId: string; qty: number }> }): Promise<Result> {
  const who = await person()
  if (!who) return NO_NAME
  const items = input.items.filter((i) => i.productVariantId && i.qty > 0)
  if (!items.length) return { ok: false, error: 'Add at least one piece.' }
  const r = await run('record_stylist_pull', { ...input, items, project: input.project || undefined, dueBackAt: input.dueBackAt || undefined }, who)
  if (failed(r)) return { ok: false, error: failed(r)! }
  const stock = Array.isArray(r.stock) ? (r.stock as string[]) : []
  const problem = stock.find((s) => /NOT|paused/.test(s))
  return { ok: true, message: problem ? `Saved, but check stock: ${problem}` : 'Saved, and taken off stock.' }
}

/** Pieces back: one line (lineId + qty) or everything still out on the pull. */
export async function returnPieces(input: { pullId: string; lineId?: string; qty?: number }): Promise<Result> {
  const who = await person()
  if (!who) return NO_NAME
  const r = await run('record_pull_return', input.lineId
    ? { pullId: input.pullId, items: [{ lineId: input.lineId, qty: input.qty ?? 1 }] }
    : { pullId: input.pullId, everythingBack: true }, who)
  if (failed(r)) return { ok: false, error: failed(r)! }
  const back = Array.isArray(r.returned) ? (r.returned as string[]) : []
  const problem = back.find((s) => /NOT|paused/.test(s))
  return { ok: true, message: problem ? `Marked back, but check stock: ${problem}` : 'Back on stock.' }
}

export async function setRequestStatus(requestId: string, status: 'OPEN' | 'FULFILLED' | 'CLOSED'): Promise<Result> {
  const who = await person()
  if (!who) return NO_NAME
  const r = await run('update_stylist_request', { requestId, status }, who)
  return failed(r) ? { ok: false, error: failed(r)! } : { ok: true }
}

/**
 * A note from anyone on the team, on one stylist or on the page as a whole.
 * Kept as a Note, so Mouse reads it too. Signed and dated in its own words.
 */
export async function addStylistNote(input: { stylistId?: string; text: string }): Promise<Result> {
  const who = await person()
  if (!who) return NO_NAME
  const text = input.text.trim()
  if (!text) return { ok: false, error: 'The note is empty.' }
  const s = input.stylistId ? await db.stylist.findUnique({ where: { id: input.stylistId }, select: { name: true } }) : null
  if (input.stylistId && !s) return { ok: false, error: 'No such stylist.' }
  const day = new Date().toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric' })
  await db.note.create({
    data: {
      entityType: 'GENERAL',
      entityId: input.stylistId ? `stylist:${input.stylistId}` : 'stylists',
      content: `${s ? `Stylist ${s.name}: ` : 'Stylists: '}${text} (${who.name.split(' ')[0]}, ${day})`,
      source: 'MANUAL',
    },
  })
  revalidatePath('/stylists')
  return { ok: true }
}
