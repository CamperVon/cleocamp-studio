'use server'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { currentPersonId } from '@/lib/session'

/**
 * Wholesale accounts by hand. Brandon, 30 Sept 2026: "need to be able to add
 * new one manually", and "remove cafe forgot from wholesale, they are gone."
 * Removing an account hides it (active: false) rather than deleting it: its
 * shipments and what was paid stay on record, and it can come back.
 */
type Result = { ok: true; message?: string } | { ok: false; error: string }

async function signedIn() {
  const id = await currentPersonId()
  return id ? db.person.findFirst({ where: { id, active: true, external: false }, select: { id: true } }) : null
}
const NO_NAME: Result = { ok: false, error: 'Open the app from your own link so this carries your name.' }

export type AccountInput = { name: string; type: 'WHOLESALE' | 'CONSIGNMENT'; commissionSplit: string; contactName: string; email: string; address: string; notes: string }

function clean(input: AccountInput): { data: Record<string, unknown> } | { error: string } {
  const name = input.name.trim()
  if (!name) return { error: 'The account needs a name.' }
  const email = input.email.trim().toLowerCase()
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: 'That email does not look right.' }
  const blank = (v: string) => v.trim() || null
  return {
    data: {
      name, type: input.type === 'CONSIGNMENT' ? 'CONSIGNMENT' : 'WHOLESALE',
      // A split is only recorded as told, and only for consignment.
      commissionSplit: input.type === 'CONSIGNMENT' ? blank(input.commissionSplit) : null,
      contactName: blank(input.contactName), email: email || null, address: blank(input.address), notes: blank(input.notes),
    },
  }
}

export async function addAccount(input: AccountInput): Promise<Result> {
  if (!(await signedIn())) return NO_NAME
  const c = clean(input)
  if ('error' in c) return { ok: false, error: c.error }
  const same = await db.wholesaleAccount.findFirst({ where: { name: { equals: String(c.data.name), mode: 'insensitive' } }, select: { active: true } })
  if (same) return { ok: false, error: same.active ? 'There is already an account with that name.' : 'That account was removed before. Put it back from the removed list instead.' }
  await db.wholesaleAccount.create({ data: c.data as never })
  revalidatePath('/wholesale')
  return { ok: true, message: 'Added.' }
}

export async function updateAccount(id: string, input: AccountInput): Promise<Result> {
  if (!(await signedIn())) return NO_NAME
  const c = clean(input)
  if ('error' in c) return { ok: false, error: c.error }
  const r = await db.wholesaleAccount.update({ where: { id }, data: c.data as never, select: { id: true } }).catch(() => null)
  if (!r) return { ok: false, error: 'No such account.' }
  revalidatePath('/wholesale')
  return { ok: true, message: 'Saved.' }
}

export async function setAccountActive(id: string, active: boolean): Promise<Result> {
  if (!(await signedIn())) return NO_NAME
  const r = await db.wholesaleAccount.update({ where: { id }, data: { active }, select: { id: true } }).catch(() => null)
  if (!r) return { ok: false, error: 'No such account.' }
  revalidatePath('/wholesale')
  return { ok: true }
}
