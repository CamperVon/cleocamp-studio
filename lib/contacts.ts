import { db } from '@/lib/db'
import type { ContactCircle } from '@/generated/prisma/client'

/**
 * People Cleo Camp keeps close, on two pages (Brandon, 1 Oct 2026):
 * Friends of the Brand (press, editors, artists) and the Cleo Crew, which is
 * the people working for Cleo (CREW) and the "Friends We Like to Work With"
 * (WORKS_WITH: photographers, sample makers). The pages and Mouse
 * (save_contact, find_contacts) both write through here, so the rules are one
 * set: kept as given, a name required, an email checked for shape only, blank
 * clears a field, and removing hides rather than deletes.
 */
export const CIRCLES: Record<ContactCircle, string> = {
  FRIEND_OF_BRAND: 'Friends of the Brand',
  CREW: 'Cleo Crew, internal',
  WORKS_WITH: 'Cleo Crew, Friends We Like to Work With',
}
export const isCircle = (v: unknown): v is ContactCircle => typeof v === 'string' && v in CIRCLES
export type ContactInput = {
  name?: string; role?: string; company?: string; email?: string; phone?: string; instagram?: string; address?: string; notes?: string
}
const FIELDS = ['name', 'role', 'company', 'email', 'phone', 'instagram', 'address', 'notes'] as const

/** What to save, or why not. Only the fields given are touched; "" clears one. Pure. */
export function cleanContact(input: ContactInput, isNew: boolean): { data: Record<string, string | null> } | { error: string } {
  const data: Record<string, string | null> = {}
  for (const k of FIELDS) {
    const v = input[k]
    if (typeof v !== 'string') continue
    const t = v.trim()
    data[k] = t ? (k === 'email' ? t.toLowerCase() : k === 'instagram' ? t.replace(/^@/, '') : t) : null
  }
  if ((isNew || 'name' in data) && !data.name) return { error: 'Needs a name.' }
  if (data.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email)) return { error: `"${data.email}" does not look like an email address.` }
  return { data }
}

/** Anyone kept at the top first, then A to Z by name, ignoring case and accents. Pure. */
export const byName = (a: { name: string; atTop?: boolean }, b: { name: string; atTop?: boolean }) =>
  Number(!!b.atTop) - Number(!!a.atTop) || a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })

export async function listContacts(circles: ContactCircle[], opts: { removed?: boolean } = {}) {
  const rows = await db.contact.findMany({ where: { circle: { in: circles }, removedAt: opts.removed ? { not: null } : null } })
  return rows.sort(byName)
}

export async function addContact(circle: ContactCircle, input: ContactInput) {
  const c = cleanContact(input, true)
  if ('error' in c) return { ok: false as const, error: c.error }
  const same = await db.contact.findFirst({ where: { circle, name: { equals: c.data.name!, mode: 'insensitive' } }, select: { id: true, removedAt: true } })
  if (same) return { ok: false as const, error: same.removedAt ? `${c.data.name} was removed from ${CIRCLES[circle]} before; put them back instead.` : `${c.data.name} is already on ${CIRCLES[circle]} (id ${same.id}). Change them rather than add again.` }
  const f = await db.contact.create({ data: { ...(c.data as { name: string }), circle }, select: { id: true, name: true } })
  return { ok: true as const, contact: f }
}

/** Change details, or move between lists with circle. */
export async function updateContact(id: string, input: ContactInput, circle?: ContactCircle) {
  const c = cleanContact(input, false)
  if ('error' in c) return { ok: false as const, error: c.error }
  if (!Object.keys(c.data).length && !circle) return { ok: false as const, error: 'Nothing to change.' }
  const f = await db.contact.update({ where: { id }, data: { ...c.data, ...(circle ? { circle } : {}) }, select: { id: true, name: true } }).catch(() => null)
  return f ? { ok: true as const, contact: f } : { ok: false as const, error: 'No such person on the list.' }
}

export async function setContactRemoved(id: string, removed: boolean) {
  const f = await db.contact.update({ where: { id }, data: { removedAt: removed ? new Date() : null }, select: { id: true, name: true } }).catch(() => null)
  return f ? { ok: true as const, contact: f } : { ok: false as const, error: 'No such person on the list.' }
}
