import { db } from '@/lib/db'
import { keepLink, linkProblem } from '@/lib/files'

/**
 * The Drive page (19 Nov 2026, Brandon: "a page in studio mouse that connects
 * to our google drive, so we can quickly get to pages"). Kept Google Drive
 * links, by section, one tap to open, plus a search that opens Google Drive's
 * own search in the person's own signed-in browser. Nothing in Drive is read
 * or copied: the app holds the address only, and needs no Google key.
 *
 * A link is a kept file with a url (lib/files.ts), so it also shows in Files.
 * Its section is a StoredFileLink of kind "drive" whose recordId is the
 * section's name, so no new table was needed. The style folders already kept
 * on products show here too, under "Style folders", without being pinned.
 */

export const DRIVE_LINK_KIND = 'drive'
export const STYLE_FOLDERS = 'Style folders'

/** Is this a Google Drive, Docs, Sheets, Slides or Forms address? Pure. */
export function isDriveUrl(url: string): boolean {
  try {
    const h = new URL(url.trim()).hostname.toLowerCase()
    return h === 'drive.google.com' || h === 'docs.google.com'
  } catch {
    return false
  }
}

/** What kind of Drive page a link opens, for the little label beside it. Pure. */
export function driveKind(url: string): 'Folder' | 'Doc' | 'Sheet' | 'Slides' | 'Form' | 'File' | 'Link' {
  let u: URL
  try { u = new URL(url.trim()) } catch { return 'Link' }
  const p = u.pathname
  if (u.hostname === 'drive.google.com') return /\/folders\//.test(p) ? 'Folder' : 'File'
  if (u.hostname === 'docs.google.com') {
    if (p.startsWith('/document/')) return 'Doc'
    if (p.startsWith('/spreadsheets/')) return 'Sheet'
    if (p.startsWith('/presentation/')) return 'Slides'
    if (p.startsWith('/forms/')) return 'Form'
    return 'File'
  }
  return 'Link'
}

/** Google Drive's own search for these words, opened in the person's browser. Pure. */
export function driveSearchUrl(q: string): string {
  return `https://drive.google.com/drive/search?q=${encodeURIComponent(q.trim())}`
}

/** A section name as typed, tidied: "  newsletter " → "Newsletter". Pure. */
export function sectionName(s: string | null | undefined): string {
  const t = (s ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : 'General'
}

export type DriveLink = { id: string; title: string; url: string; notes: string | null; kind: ReturnType<typeof driveKind>; pinId: string | null }

/** Every section with its links, sections A to Z with "Style folders" last. */
export async function driveSections(): Promise<Array<{ name: string; links: DriveLink[] }>> {
  const files = await db.storedFile.findMany({
    where: { url: { not: null } },
    orderBy: { title: 'asc' },
    select: { id: true, title: true, url: true, notes: true, links: { select: { id: true, kind: true, recordId: true } } },
  })
  const by = new Map<string, DriveLink[]>()
  const add = (name: string, l: DriveLink) => by.set(name, [...(by.get(name) ?? []), l])
  for (const f of files) {
    const url = f.url!
    const pins = f.links.filter((l) => l.kind === DRIVE_LINK_KIND)
    for (const p of pins) add(p.recordId, { id: f.id, title: f.title, url, notes: f.notes, kind: driveKind(url), pinId: p.id })
    if (!pins.length && isDriveUrl(url) && f.links.some((l) => l.kind === 'product')) add(STYLE_FOLDERS, { id: f.id, title: f.title, url, notes: f.notes, kind: driveKind(url), pinId: null })
  }
  return [...by.entries()]
    .map(([name, links]) => ({ name, links }))
    .sort((a, b) => (a.name === STYLE_FOLDERS ? 1 : b.name === STYLE_FOLDERS ? -1 : a.name.localeCompare(b.name)))
}

/**
 * Keep a Drive link on the Drive page under a section, and in Files. The same
 * address kept twice is one link, pinned to each section it was given.
 */
export async function keepDriveLink(input: { title: string; url: string; section?: string | null; notes?: string | null; links?: Array<{ kind: string; recordId: string }> }): Promise<{ ok: true; id: string; section: string } | { ok: false; error: string }> {
  const problem = linkProblem(input.url)
  if (problem) return { ok: false, error: problem }
  if (!isDriveUrl(input.url)) return { ok: false, error: 'That is not a Google Drive, Docs or Sheets link. Copy the link from Google Drive (Share, then Copy link).' }
  const r = await keepLink({ title: input.title, url: input.url, notes: input.notes, links: input.links })
  if (!r.ok) return r
  const section = sectionName(input.section)
  await db.storedFileLink.upsert({
    where: { fileId_kind_recordId: { fileId: r.id, kind: DRIVE_LINK_KIND, recordId: section } },
    create: { fileId: r.id, kind: DRIVE_LINK_KIND, recordId: section },
    update: {},
  })
  return { ok: true, id: r.id, section }
}
