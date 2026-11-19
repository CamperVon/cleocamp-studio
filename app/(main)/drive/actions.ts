'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { DRIVE_LINK_KIND, keepDriveLink } from '@/lib/drive'

type Result = { ok: true } | { ok: false; error: string }

const touched = () => { revalidatePath('/drive'); revalidatePath('/files') }

/** Keep a Google Drive link on the Drive page under a section. */
export async function addDriveLink(title: string, url: string, section: string): Promise<Result> {
  if (!title.trim()) return { ok: false, error: 'Give it a name.' }
  const r = await keepDriveLink({ title, url, section })
  if (!r.ok) return r
  touched()
  return { ok: true }
}

/** Take a link off the Drive page. It stays in Files; nothing in Drive changes. */
export async function unpinDriveLink(pinId: string): Promise<Result> {
  await db.storedFileLink.deleteMany({ where: { id: pinId, kind: DRIVE_LINK_KIND } })
  touched()
  return { ok: true }
}
