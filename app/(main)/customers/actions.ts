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
