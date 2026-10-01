'use server'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { currentPersonId } from '@/lib/session'

/** "Not them": a notable match that is the wrong person stays off every list and out of the Daily Cheese. "Undo" brings it back. */
export async function setNotThem(customerId: string, notThem: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  const id = await currentPersonId()
  const who = id ? await db.person.findFirst({ where: { id, active: true, external: false }, select: { id: true } }) : null
  if (!who) return { ok: false, error: 'Open the app from your own link so this carries your name.' }
  const r = await db.customer.update({ where: { id: customerId }, data: { notableDismissedAt: notThem ? new Date() : null }, select: { id: true } }).catch(() => null)
  if (!r) return { ok: false, error: 'No such customer.' }
  revalidatePath('/customers')
  return { ok: true }
}

type Result = { ok: true; message?: string } | { ok: false; error: string }
async function signedIn() {
  const id = await currentPersonId()
  return id ? db.person.findFirst({ where: { id, active: true, external: false }, select: { id: true } }) : null
}
const NO_NAME: Result = { ok: false, error: 'Open the app from your own link so this carries your name.' }

/** "+ Add a customer" (Brandon, 1 Oct 2026). */
export async function addCustomer(input: { name: string; email: string; notes: string }): Promise<Result> {
  if (!(await signedIn())) return NO_NAME
  const { addCustomerByHand } = await import('@/lib/customers')
  const r = await addCustomerByHand(input)
  if (!r.ok) return { ok: false, error: r.error }
  revalidatePath('/customers')
  return { ok: true, message: r.existing ? `${r.customer.name} is on Shopify; added from there.` : r.unchecked ? `Added ${r.customer.name}. Could not reach Shopify to check for them; they link up by email overnight.` : `Added ${r.customer.name}. Not on Shopify yet.` }
}

export async function saveCustomerNotes(id: string, notes: string): Promise<Result> {
  if (!(await signedIn())) return NO_NAME
  const { setCustomerNotes } = await import('@/lib/customers')
  const r = await setCustomerNotes(id, notes)
  if (!r.ok) return r
  revalidatePath('/customers')
  return { ok: true, message: 'Saved.' }
}

export async function pinCustomer(id: string, pinned: boolean): Promise<Result> {
  if (!(await signedIn())) return NO_NAME
  const { setCustomerPinned } = await import('@/lib/customers')
  const r = await setCustomerPinned(id, pinned)
  if (!r.ok) return r
  revalidatePath('/customers')
  return { ok: true }
}
