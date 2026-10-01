'use server'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { currentPersonId } from '@/lib/session'
import { addContact, isCircle, setContactRemoved, updateContact, type ContactInput } from '@/lib/contacts'

/**
 * Friends of the Brand and the Cleo Crew by hand. Brandon, 1 Oct 2026: "Add
 * manual entry (and of course we can tell mouse.)" Removing hides someone
 * rather than deleting them, so they can be put back.
 */
type Result = { ok: true; message?: string } | { ok: false; error: string }

async function signedIn() {
  const id = await currentPersonId()
  return id ? db.person.findFirst({ where: { id, active: true, external: false }, select: { id: true } }) : null
}
const NO_NAME: Result = { ok: false, error: 'Open the app from your own link so this carries your name.' }
const refresh = () => { revalidatePath('/friends'); revalidatePath('/crew') }

export async function addContactByHand(circle: string, input: ContactInput): Promise<Result> {
  if (!(await signedIn())) return NO_NAME
  if (!isCircle(circle)) return { ok: false, error: 'Which list?' }
  const r = await addContact(circle, input)
  if (!r.ok) return r
  refresh()
  return { ok: true, message: `Added ${r.contact.name}.` }
}

export async function updateContactByHand(id: string, input: ContactInput, circle?: string): Promise<Result> {
  if (!(await signedIn())) return NO_NAME
  const r = await updateContact(id, input, isCircle(circle) ? circle : undefined)
  if (!r.ok) return r
  refresh()
  return { ok: true, message: 'Saved.' }
}

export async function setContactRemovedByHand(id: string, removed: boolean): Promise<Result> {
  if (!(await signedIn())) return NO_NAME
  const r = await setContactRemoved(id, removed)
  if (!r.ok) return r
  refresh()
  return { ok: true }
}
