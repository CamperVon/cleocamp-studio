'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { checkLinks } from '@/lib/files'

type Result = { ok: true } | { ok: false; error: string }

const touched = () => { for (const p of ['/files', '/products', '/components', '/vendors']) revalidatePath(p) }

export async function linkFile(fileId: string, kind: string, recordId: string): Promise<Result> {
  const c = await checkLinks([{ kind, recordId }])
  if ('error' in c) return { ok: false, error: c.error }
  await db.storedFileLink.upsert({ where: { fileId_kind_recordId: { fileId, kind, recordId } }, create: { fileId, kind, recordId }, update: {} })
  touched()
  return { ok: true }
}

export async function unlinkFile(linkId: string): Promise<Result> {
  await db.storedFileLink.deleteMany({ where: { id: linkId } })
  touched()
  return { ok: true }
}

export async function renameFile(fileId: string, title: string, notes: string): Promise<Result> {
  if (!title.trim()) return { ok: false, error: 'Give it a title.' }
  await db.storedFile.update({ where: { id: fileId }, data: { title: title.trim(), notes: notes.trim() || null } })
  touched()
  return { ok: true }
}

/** Deleting a kept file is for good: asked to confirm in the page first. */
export async function deleteFile(fileId: string): Promise<Result> {
  await db.storedFile.deleteMany({ where: { id: fileId } })
  touched()
  return { ok: true }
}
