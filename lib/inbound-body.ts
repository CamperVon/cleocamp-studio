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
