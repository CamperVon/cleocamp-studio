import { db } from '@/lib/db'

/**
 * Files kept for good, linked to products, components and vendors (Brandon,
 * 6 Oct 2026). See StoredFile in prisma/schema.prisma.
 */

/** A Vercel request carries at most 4.5 MB; keep each file under that. */
export const MAX_FILE_BYTES = 4 * 1024 * 1024

/** What can be kept: documents and pictures. Mouse can read PDFs and these images. */
export const FILE_TYPES: Record<string, string> = {
  'application/pdf': 'PDF',
  'image/jpeg': 'photo',
  'image/png': 'picture',
  'image/webp': 'picture',
  'image/gif': 'picture',
}

export const LINK_KINDS = ['product', 'component', 'vendor'] as const
export type LinkKind = (typeof LINK_KINDS)[number]

/** Why a file cannot be kept, or null if it can. Pure. */
export function fileProblem(f: { mediaType: string; sizeBytes: number; title?: string }): string | null {
  if (!FILE_TYPES[f.mediaType]) return 'Only PDFs and photos (JPEG, PNG, WebP, GIF) can be kept here.'
  if (f.sizeBytes <= 0) return 'That file is empty.'
  if (f.sizeBytes > MAX_FILE_BYTES) return `That file is ${(f.sizeBytes / 1048576).toFixed(1)} MB; the limit is 4 MB. Scan or export it at a lower resolution and try again.`
  if (f.title !== undefined && !f.title.trim()) return 'Give it a title.'
  return null
}

export function sizeLabel(bytes: number): string {
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/** The page a linked record lives on, opened at its row (app/ui/jump.tsx). Pure. */
export function recordHref(kind: string, id: string): string {
  return `/${kind === 'product' ? 'products' : kind === 'component' ? 'components' : 'vendors'}#rec-${id}`
}

/** Every record a file can be linked to, A to Z, for the pickers. */
export async function linkTargets() {
  const [products, components, vendors] = await Promise.all([
    db.product.findMany({ where: { status: { not: 'SUNSETTED' } }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    db.component.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    db.vendor.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ])
  return { product: products, component: components, vendor: vendors }
}

/** For each record, the files linked to it: { recordId: [{ id, title }] }. */
export async function filesFor(kind: LinkKind, recordIds?: string[]): Promise<Map<string, Array<{ id: string; title: string }>>> {
  const links = await db.storedFileLink.findMany({
    where: { kind, ...(recordIds ? { recordId: { in: recordIds } } : {}) },
    select: { recordId: true, file: { select: { id: true, title: true } } },
    orderBy: { file: { title: 'asc' } },
  })
  const m = new Map<string, Array<{ id: string; title: string }>>()
  for (const l of links) m.set(l.recordId, [...(m.get(l.recordId) ?? []), l.file])
  return m
}

/** Keep a file and link it. Checks first; nothing is written if anything is wrong. */
export async function keepFile(input: {
  title: string; filename: string; mediaType: string; base64: string; notes?: string | null
  links?: Array<{ kind: string; recordId: string }>
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const sizeBytes = Buffer.byteLength(input.base64, 'base64')
  const problem = fileProblem({ mediaType: input.mediaType, sizeBytes, title: input.title })
  if (problem) return { ok: false, error: problem }
  const links = await checkLinks(input.links ?? [])
  if ('error' in links) return { ok: false, error: links.error }
  const f = await db.storedFile.create({
    data: { ...storedFileData({ ...input, sizeBytes }), links: { create: links.ok } },
    select: { id: true },
  })
  return { ok: true, id: f.id }
}

/** The row keepFile writes, links aside: notes kept, trimmed, or null when blank. Pure. */
export function storedFileData(input: { title: string; filename: string; mediaType: string; base64: string; sizeBytes: number; notes?: string | null }) {
  return {
    title: input.title.trim(), filename: input.filename || 'file', mediaType: input.mediaType, sizeBytes: input.sizeBytes, data: input.base64,
    notes: input.notes?.trim() || null,
  }
}

/** The Files page's upload (app/api/files): the form's file, title, notes and links, handed to keepFile. */
export async function uploadFromForm(form: FormData, keep: typeof keepFile = keepFile): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const file = form.get('file')
  if (!(file instanceof File)) return { ok: false, error: 'No file came through.' }
  let links: Array<{ kind: string; recordId: string }> = []
  try { links = JSON.parse(String(form.get('links') ?? '[]')) } catch { return { ok: false, error: 'The links were unreadable.' } }
  return keep({
    title: String(form.get('title') ?? '') || file.name.replace(/\.[a-z0-9]+$/i, ''),
    filename: file.name,
    mediaType: file.type,
    base64: Buffer.from(await file.arrayBuffer()).toString('base64'),
    notes: String(form.get('notes') ?? ''),
    links,
  })
}

// ── keep_file: a file just sent in this chat, never another conversation's ──

/** How far back keep_file looks for a file sent in chat. */
export const KEEP_WINDOW_MS = 30 * 60 * 1000

export type ChatFile = { threadId: string; filename: string; mediaType: string; data: string | null; createdAt: Date }

/**
 * Which recent attachment keep_file means: only ones sent in this chat
 * thread, in the last half hour, still holding their bytes; the newest, or
 * the one with the filename given. An attachment from any other thread is
 * never chosen, however recent or however named. Pure.
 */
export function chooseChatAttachment(threadId: string, candidates: ChatFile[], filename?: string | null, now = new Date()): { file: ChatFile } | { error: string } {
  const mine = candidates
    .filter((c) => c.threadId === threadId && c.data && +now - +c.createdAt <= KEEP_WINDOW_MS && (!filename || c.filename === filename))
    .sort((a, b) => +b.createdAt - +a.createdAt)
  if (!mine.length) {
    return { error: filename
      ? `No file called "${filename}" was sent in this chat in the last half hour. Ask them to attach it again.`
      : 'No file was sent in this chat in the last half hour. Ask them to attach it again.' }
  }
  const a = mine[0]
  const others = mine.slice(1).filter((x) => +a.createdAt - +x.createdAt < 60_000).map((x) => x.filename)
  if (!filename && others.length) return { error: `More than one file was just sent (${[a.filename, ...others].join(', ')}). Say which one with filename.` }
  return { file: a }
}

/** This thread's recent attachments; the query is limited to the thread as well. */
async function threadAttachments(threadId: string): Promise<ChatFile[]> {
  const rows = await db.chatAttachment.findMany({
    where: { message: { threadId }, createdAt: { gte: new Date(Date.now() - KEEP_WINDOW_MS) }, data: { not: null } },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: { filename: true, mediaType: true, data: true, createdAt: true, message: { select: { threadId: true } } },
  })
  return rows.map((r) => ({ threadId: r.message.threadId, filename: r.filename, mediaType: r.mediaType, data: r.data, createdAt: r.createdAt }))
}

/**
 * keep_file's work. Needs the chat thread it was called from: with none (any
 * run that is not an interactive chat) nothing is looked up and nothing saved.
 */
export async function keepChatFile(
  threadId: string | null | undefined,
  input: { title?: unknown; filename?: unknown; notes?: unknown; links?: unknown },
  deps: { find: (threadId: string) => Promise<ChatFile[]>; keep: typeof keepFile } = { find: threadAttachments, keep: keepFile },
) {
  if (!threadId) return { ok: false, kept: false, reason: 'Files can only be kept from a chat conversation. Ask them to attach it in chat.' }
  const filename = typeof input.filename === 'string' && input.filename.trim() ? input.filename.trim() : null
  const c = chooseChatAttachment(threadId, await deps.find(threadId), filename)
  if ('error' in c) return { ok: false, kept: false, reason: c.error }
  const a = c.file
  const links = ((Array.isArray(input.links) ? input.links : []) as Array<{ kind: string; id: string }>).map((l) => ({ kind: l.kind, recordId: l.id }))
  const title = String(input.title ?? '')
  const r = await deps.keep({ title, filename: a.filename, mediaType: a.mediaType, base64: a.data!, notes: typeof input.notes === 'string' ? input.notes : null, links })
  if (!r.ok) return { ok: false, kept: false, reason: r.error }
  return { kept: true, id: r.id, file: a.filename, linked: links.length, tellTheUser: `Kept "${title}" (${a.filename}) in Files${links.length ? `, linked to ${links.length} record${links.length === 1 ? '' : 's'}` : ''}.` }
}

/** Links that point at real records, or the first that does not. */
export async function checkLinks(links: Array<{ kind: string; recordId: string }>): Promise<{ ok: Array<{ kind: LinkKind; recordId: string }> } | { error: string }> {
  const ok: Array<{ kind: LinkKind; recordId: string }> = []
  for (const l of links) {
    if (!(LINK_KINDS as readonly string[]).includes(l.kind)) return { error: `A file links to a product, component or vendor, not "${l.kind}".` }
    const kind = l.kind as LinkKind
    const found = kind === 'product' ? await db.product.findUnique({ where: { id: l.recordId }, select: { id: true } })
      : kind === 'component' ? await db.component.findUnique({ where: { id: l.recordId }, select: { id: true } })
      : await db.vendor.findUnique({ where: { id: l.recordId }, select: { id: true } })
    if (!found) return { error: `No ${kind} ${l.recordId}.` }
    if (!ok.some((x) => x.kind === kind && x.recordId === l.recordId)) ok.push({ kind, recordId: l.recordId })
  }
  return { ok }
}
