/**
 * The words of a message whose body arrived empty.
 *
 * A text to mouse@ that carries a picture, or runs past one SMS, reaches us as
 * MMS through the carrier's email gateway (…@tmomail.net and friends), and the
 * carrier puts the words in an attached text_1.txt rather than in the body.
 * Until 23 Sept 2026 only the body was read, so those texts reached Mouse as
 * "(no body)" and nothing happened — Brandon's 10:54pm text about PO 2356
 * went that way, with a screenshot, and he was left asking why Mouse would
 * not clear the order. Nothing threw; it just read an empty message.
 *
 * Returns the joined text/plain attachments, or null if there are none or
 * they cannot be fetched.
 */
type AttachmentMeta = { id?: string; filename?: string | null; content_type?: string; download_url?: string }

export function textAttachmentsIn(raw: unknown): AttachmentMeta[] {
  const list = (raw as { data?: { attachments?: AttachmentMeta[] } })?.data?.attachments
  return Array.isArray(list) ? list.filter((a) => a.content_type?.startsWith('text/plain')) : []
}

export async function textFromAttachments(emailId: string | undefined, raw: unknown): Promise<string | null> {
  const key = process.env.RESEND_API_KEY
  if (!emailId || !key || !textAttachmentsIn(raw).length) return null
  try {
    const r = await fetch(`https://api.resend.com/emails/receiving/${emailId}/attachments`, {
      headers: { Authorization: `Bearer ${key}` },
    })
    if (!r.ok) return null
    const body = (await r.json()) as { data?: AttachmentMeta[] }
    const parts: string[] = []
    for (const a of body.data ?? []) {
      if (!a.content_type?.startsWith('text/plain') || !a.download_url) continue
      const f = await fetch(a.download_url)
      if (f.ok) parts.push((await f.text()).trim())
    }
    const text = parts.filter(Boolean).join('\n\n')
    return text || null
  } catch {
    return null
  }
}

/**
 * PDFs and photos on an email from the team, for Mouse to read as it reads a
 * file attached in the chat. Brandon, 6 Oct 2026: "Yes on reading invoices",
 * after being told Mouse could only say it could not open an emailed invoice.
 * Only ever called for team mail (lib/mouse/nightly-pass.ts); anyone else's
 * attachments are never fetched. At most three files, each under 4MB, the
 * same limits as the chat; anything else is named in `skipped` so Mouse can
 * say what it did not read.
 */
export const READABLE = /^(application\/pdf|image\/(jpeg|png|webp))$/
const MAX_FILES = 3
const MAX_BYTES = 4 * 1024 * 1024

export function readableAttachmentsIn(raw: unknown): AttachmentMeta[] {
  const list = (raw as { data?: { attachments?: AttachmentMeta[] } })?.data?.attachments
  return Array.isArray(list) ? list.filter((a) => READABLE.test(a.content_type ?? '')) : []
}

export async function fileAttachments(emailId: string | undefined, raw: unknown): Promise<{ files: Array<{ mediaType: string; base64: string; filename: string }>; skipped: string[] }> {
  const key = process.env.RESEND_API_KEY
  const out = { files: [] as Array<{ mediaType: string; base64: string; filename: string }>, skipped: [] as string[] }
  if (!emailId || !key || !readableAttachmentsIn(raw).length) return out
  try {
    const r = await fetch(`https://api.resend.com/emails/receiving/${emailId}/attachments`, { headers: { Authorization: `Bearer ${key}` } })
    if (!r.ok) return out
    const body = (await r.json()) as { data?: AttachmentMeta[] }
    for (const a of body.data ?? []) {
      const type = a.content_type?.split(';')[0].trim() ?? ''
      if (!READABLE.test(type) || !a.download_url) continue
      const name = a.filename ?? type
      if (out.files.length >= MAX_FILES) { out.skipped.push(`${name} (more than ${MAX_FILES} files)`); continue }
      const f = await fetch(a.download_url)
      if (!f.ok) { out.skipped.push(`${name} (could not be fetched)`); continue }
      const bytes = Buffer.from(await f.arrayBuffer())
      if (bytes.length > MAX_BYTES) { out.skipped.push(`${name} (over 4MB)`); continue }
      out.files.push({ mediaType: type, base64: bytes.toString('base64'), filename: name })
    }
  } catch {
    // Unreadable is said, not hidden: the caller names what it could not open.
  }
  return out
}
