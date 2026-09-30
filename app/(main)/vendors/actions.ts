'use server'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { currentPersonId } from '@/lib/session'

/**
 * Vendors by hand. Brandon, 30 Sept 2026: "need to be able to manually add
 * vendors as well", and to remove them. Removing hides a vendor (active:
 * false) rather than deleting it: its purchase orders, components and runs
 * point at it, and it can come back.
 */
type Result = { ok: true; message?: string } | { ok: false; error: string }
const NO_NAME: Result = { ok: false, error: 'Open the app from your own link so this carries your name.' }
async function signedIn() {
  const id = await currentPersonId()
  return id ? db.person.findFirst({ where: { id, active: true, external: false }, select: { id: true } }) : null
}

export type VendorInput = {
  name: string; role: 'COMPONENT_SUPPLIER' | 'MANUFACTURER' | 'DYE_HOUSE' | 'OTHER'; legalName: string; contactName: string
  email: string; ccEmails: string; address: string; orderMethod: string; paymentTerms: string; leadTimeDays: string; notes: string
}

function clean(v: VendorInput): { data: Record<string, unknown> } | { error: string } {
  const name = v.name.trim()
  if (!name) return { error: 'The vendor needs a name.' }
  const email = v.email.trim().toLowerCase()
  const bad = (e: string) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)
  if (email && bad(email)) return { error: 'That email does not look right.' }
  const cc = v.ccEmails.split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean)
  if (cc.some(bad)) return { error: 'One of the cc emails does not look right.' }
  const lead = v.leadTimeDays.trim()
  if (lead && !(Number.isInteger(Number(lead)) && Number(lead) >= 0)) return { error: 'Lead time is a number of days, like 21.' }
  const blank = (s: string) => s.trim() || null
  return {
    data: {
      name, role: ['COMPONENT_SUPPLIER', 'MANUFACTURER', 'DYE_HOUSE', 'OTHER'].includes(v.role) ? v.role : 'OTHER',
      legalName: blank(v.legalName), contactName: blank(v.contactName), email: email || null, ccEmails: cc.length ? cc.join(', ') : null,
      address: blank(v.address), orderMethod: blank(v.orderMethod), paymentTerms: blank(v.paymentTerms),
      // Blank stays unknown, never zero: a guessed lead time is worse than none (CLAUDE.md §3).
      leadTimeDays: lead ? Number(lead) : null, notes: blank(v.notes),
    },
  }
}

export async function addVendor(v: VendorInput): Promise<Result> {
  if (!(await signedIn())) return NO_NAME
  const c = clean(v)
  if ('error' in c) return { ok: false, error: c.error }
  const same = await db.vendor.findFirst({ where: { name: { equals: String(c.data.name), mode: 'insensitive' } }, select: { active: true } })
  if (same) return { ok: false, error: same.active ? 'There is already a vendor with that name.' : 'That vendor was removed before. Put it back from the removed list instead.' }
  await db.vendor.create({ data: c.data as never })
  revalidatePath('/vendors')
  return { ok: true, message: 'Added.' }
}

export async function updateVendor(id: string, v: VendorInput): Promise<Result> {
  if (!(await signedIn())) return NO_NAME
  const c = clean(v)
  if ('error' in c) return { ok: false, error: c.error }
  const r = await db.vendor.update({ where: { id }, data: c.data as never, select: { id: true } }).catch(() => null)
  if (!r) return { ok: false, error: 'No such vendor.' }
  revalidatePath('/vendors')
  return { ok: true, message: 'Saved.' }
}

export async function setVendorActive(id: string, active: boolean): Promise<Result> {
  if (!(await signedIn())) return NO_NAME
  const r = await db.vendor.update({ where: { id }, data: { active }, select: { id: true } }).catch(() => null)
  if (!r) return { ok: false, error: 'No such vendor.' }
  revalidatePath('/vendors')
  return { ok: true }
}
