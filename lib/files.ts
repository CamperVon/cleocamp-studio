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
    data: {
      title: input.title.trim(), filename: input.filename || 'file', mediaType: input.mediaType, sizeBytes, data: input.base64,
      notes: input.notes?.trim() || null,
      links: { create: links.ok },
    },
    select: { id: true },
  })
  return { ok: true, id: f.id }
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
