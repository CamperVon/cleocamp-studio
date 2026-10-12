/**
 * Photos for colours that are not on Shopify (Brandon, 12 Oct 2026: "just
 * because a product is not in shopify should be no reason POs don't have
 * pictures"). The Cannellini and Espresso Bean Bags went to Lorena on
 * PO 2405 as text, beside photo lines for every Shopify colour.
 *
 * A variant's photo, in order: its own (from Shopify, or one set here), any
 * other size of the same colour that has one, then the line sheet's photo of
 * that colour. A photo the app holds is addressed as /api/photo/<id>: a kept
 * file's id, or "ls_" and a line sheet row's id.
 */
import type { PrismaClient } from '@/generated/prisma/client'

export const PHOTO_PATH = '/api/photo/'
const LS = 'ls_'

type Db = Pick<PrismaClient, 'storedFile' | 'lineSheetRow' | 'productVariant'>
type V = { id: string; productId: string; colorwayId: string | null; imageUrl: string | null; colorway?: { customerName: string } | null }

/** The bytes behind /api/photo/<id>, images only. */
export async function photoBytes(id: string, db: Db): Promise<{ bytes: Buffer; mediaType: string } | null> {
  if (id.startsWith(LS)) {
    const r = await db.lineSheetRow.findUnique({ where: { id: id.slice(LS.length) }, select: { photoData: true } })
    return r?.photoData ? { bytes: Buffer.from(r.photoData), mediaType: 'image/jpeg' } : null
  }
  const f = await db.storedFile.findUnique({ where: { id }, select: { data: true, mediaType: true } })
  return f && f.mediaType.startsWith('image/') ? { bytes: Buffer.from(f.data, 'base64'), mediaType: f.mediaType } : null
}

/** Which photo each variant without one should show, by variant id. Pure. */
export function fallbackPhotos(
  want: V[],
  siblings: Array<{ productId: string; colorwayId: string | null; imageUrl: string | null }>,
  sheet: Array<{ id: string; productId: string | null; colorway: string | null }>,
): Map<string, string> {
  const out = new Map<string, string>()
  for (const v of want) {
    if (v.imageUrl) continue
    const sib = v.colorwayId ? siblings.find((s) => s.productId === v.productId && s.colorwayId === v.colorwayId && s.imageUrl) : null
    if (sib?.imageUrl) { out.set(v.id, sib.imageUrl); continue }
    const name = v.colorway?.customerName?.toLowerCase()
    const row = name ? sheet.find((r) => r.productId === v.productId && r.colorway?.toLowerCase() === name) : null
    if (row) out.set(v.id, `${PHOTO_PATH}${LS}${row.id}`)
  }
  return out
}

/** Give every line's variant without a photo the best one the app has. Changes the objects passed in. */
export async function fillPhotos(db: Db, lines: Array<{ productVariant: V | null }>): Promise<void> {
  const need = lines.map((l) => l.productVariant).filter((v): v is V => !!v && !v.imageUrl)
  if (!need.length) return
  const productIds = [...new Set(need.map((v) => v.productId))]
  const [siblings, sheet] = await Promise.all([
    db.productVariant.findMany({ where: { productId: { in: productIds }, imageUrl: { not: null } }, select: { productId: true, colorwayId: true, imageUrl: true } }),
    db.lineSheetRow.findMany({ where: { productId: { in: productIds }, photoData: { not: null } }, select: { id: true, productId: true, colorway: true } }),
  ])
  const found = fallbackPhotos(need, siblings, sheet)
  for (const v of need) v.imageUrl = found.get(v.id) ?? null
}

/** For the PDF, which is drawn on the server: an /api/photo/ address becomes the image itself. */
export async function inlinePhoto(db: Db, url: string | null): Promise<string | null> {
  if (!url?.startsWith(PHOTO_PATH)) return url
  const p = await photoBytes(url.slice(PHOTO_PATH.length), db)
  return p ? `data:${p.mediaType};base64,${p.bytes.toString('base64')}` : null
}

/**
 * Put the photo just sent in chat on a colour that is not on Shopify: kept in
 * Files (linked to the product), and every variant of that colour without a
 * Shopify link shows it. A colour Shopify sells takes its photo from Shopify.
 */
export async function setColourPhoto(threadId: string | null | undefined, input: { productId?: unknown; colorwayId?: unknown; filename?: unknown }) {
  if (!threadId) return { ok: false, reason: 'A photo can only be set from a chat conversation. Ask them to attach it in chat.' }
  const { db } = await import('@/lib/db')
  const { chooseChatAttachment, keepFile, threadAttachments } = await import('@/lib/files')
  const cw = await db.colorway.findUnique({
    where: { id: String(input.colorwayId ?? '') },
    include: { product: { select: { id: true, name: true } }, variants: { select: { id: true, shopifyVariantId: true } } },
  })
  if (!cw || cw.productId !== String(input.productId ?? cw.productId)) return { ok: false, reason: 'No such colour on that product.' }
  const appOnly = cw.variants.filter((v) => !v.shopifyVariantId)
  if (!appOnly.length) return { ok: false, reason: `${cw.product.name} in ${cw.customerName} is on Shopify, so its photo comes from Shopify. Change it there.` }
  const c = chooseChatAttachment(threadId, await threadAttachments(threadId), typeof input.filename === 'string' ? input.filename : null)
  if ('error' in c) return { ok: false, reason: c.error }
  if (!c.file.mediaType.startsWith('image/')) return { ok: false, reason: 'That attachment is not a photo.' }
  const kept = await keepFile({ title: `${cw.product.name} — ${cw.customerName} photo`, filename: c.file.filename, mediaType: c.file.mediaType, base64: c.file.data!, links: [{ kind: 'product', recordId: cw.productId }] })
  if (!kept.ok) return { ok: false, reason: kept.error }
  await db.productVariant.updateMany({ where: { id: { in: appOnly.map((v) => v.id) } }, data: { imageUrl: `${PHOTO_PATH}${kept.id}` } })
  return { ok: true, photo: kept.id, variants: appOnly.length, tellTheUser: `${cw.product.name} in ${cw.customerName} now shows this photo, on purchase orders too. It is kept in Files.` }
}
