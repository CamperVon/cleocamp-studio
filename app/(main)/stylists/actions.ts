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

/**
 * Close a pull from the page. Brandon, 30 Sept 2026: "I need to be able close
 * or remove stylist pulls from the page." KEPT leaves what is out off stock;
 * REMOVED puts back what the pull took; OPEN reopens a kept one.
 */
export async function closePull(pullId: string, as: 'KEPT' | 'REMOVED' | 'OPEN'): Promise<Result> {
  const who = await person()
  if (!who) return NO_NAME
  const r = await run('close_stylist_pull', { pullId, as }, who)
  if (r.saved === false) {
    const failed = Array.isArray(r.notPutBack) ? ` ${(r.notPutBack as string[]).join('; ')}` : ''
    return { ok: false, error: `${String(r.reason ?? 'That did not save.')}${failed}` }
  }
  const back = Array.isArray(r.putBack) ? (r.putBack as string[]).length : 0
  return { ok: true, message: as === 'REMOVED' ? (back ? `Removed; ${back} piece${back === 1 ? '' : 's'} back on stock.` : 'Removed; it had taken nothing off stock.') : undefined }
}

/**
 * A stylist's details, edited on the page. Brandon, 30 Sept 2026: "the notes
 * need to be editable. for example maya is outdated and we want all the info
 * removed." Blank clears a field, which save_stylist (Mouse's) never does.
 */
export async function updateStylist(input: { id: string; name: string; email: string; phone: string; company: string; instagram: string; notes: string }): Promise<Result> {
  const who = await person()
  if (!who) return NO_NAME
  const name = input.name.trim()
  if (!name) return { ok: false, error: 'A stylist needs a name.' }
  const email = input.email.trim().toLowerCase() || null
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: 'That email does not look right.' }
  const clean = (v: string) => v.trim() || null
  const r = await db.stylist.update({
    where: { id: input.id },
    data: { name, email, phone: clean(input.phone), company: clean(input.company), instagram: clean(input.instagram)?.replace(/^@/, '') ?? null, notes: clean(input.notes) },
    select: { id: true },
  }).catch((e) => (String(e).includes('Unique constraint') ? 'dup' : null))
  if (r === 'dup') return { ok: false, error: 'Another stylist already has that email.' }
  if (!r) return { ok: false, error: 'No such stylist.' }
  revalidatePath('/stylists')
  return { ok: true, message: 'Saved.' }
}

/**
 * Take a stylist off the page entirely: their details, requests, closed pulls
 * and notes. Refused while anything is still out with them; close or return
 * those pulls first. Stock history stays in the ledger.
 */
export async function removeStylist(id: string): Promise<Result> {
  const who = await person()
  if (!who) return NO_NAME
  const s = await db.stylist.findUnique({ where: { id }, include: { pulls: { include: { lines: true } } } })
  if (!s) return { ok: false, error: 'No such stylist.' }
  const { pullOut } = await import('@/lib/stylists')
  if (s.pulls.some((p) => pullOut(p) > 0)) return { ok: false, error: `${s.name} still has pieces out. Mark them back or close the pull first.` }
  await db.$transaction([
    db.note.updateMany({ where: { supersededAt: null, OR: [{ entityId: `stylist:${id}` }, { entityId: id }] }, data: { supersededAt: new Date() } }),
    db.stylistRequest.deleteMany({ where: { stylistId: id } }),
    db.stylistPull.deleteMany({ where: { stylistId: id } }),
    db.stylist.delete({ where: { id } }),
  ])
  revalidatePath('/stylists')
  return { ok: true }
}

/** Edit a team note: the old one is retired (never deleted) and the new words saved in its place. */
export async function editStylistNote(noteId: string, text: string): Promise<Result> {
  const who = await person()
  if (!who) return NO_NAME
  const n = await db.note.findUnique({ where: { id: noteId }, select: { entityId: true, entityType: true, content: true, supersededAt: true } })
  if (!n || n.supersededAt) return { ok: false, error: 'That note is gone. Reload the page.' }
  if (!/^stylist/.test(n.entityId ?? '')) return { ok: false, error: 'Not a stylist note.' }
  const t = text.trim()
  if (!t) return removeStylistNote(noteId)
  const prefix = /^(Stylists?(?: [^:]+)?: )/.exec(n.content)?.[1] ?? ''
  const day = new Date().toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric' })
  await db.$transaction([
    db.note.update({ where: { id: noteId }, data: { supersededAt: new Date() } }),
    db.note.create({ data: { entityType: n.entityType, entityId: n.entityId, content: `${prefix}${t} (${who.name.split(' ')[0]}, ${day})`, source: 'MANUAL' } }),
  ])
  revalidatePath('/stylists')
  return { ok: true }
}

/** Remove a team note: retired, so Mouse stops reading it; nothing is deleted. */
export async function removeStylistNote(noteId: string): Promise<Result> {
  const who = await person()
  if (!who) return NO_NAME
  const n = await db.note.findUnique({ where: { id: noteId }, select: { entityId: true } })
  if (!n || !/^stylist/.test(n.entityId ?? '')) return { ok: false, error: 'Not a stylist note.' }
  await db.note.update({ where: { id: noteId }, data: { supersededAt: new Date() } })
  revalidatePath('/stylists')
  return { ok: true }
}
