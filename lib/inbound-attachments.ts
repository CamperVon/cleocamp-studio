/**
 * Fetching the files a vendor actually sent.
 *
 * Resend's inbound webhook carries attachment METADATA only — id, filename,
 * content type, disposition — and no bytes. The bytes come from a second call
 * that hands back a signed, time-limited CDN URL (about an hour), which is
 * then downloaded. So this has to happen at forward time; there is nothing
 * useful to store and reuse later.
 *
 * Shape confirmed against the live API on 9 Sept 2026 with Betsy at
 * RichLine's mail carrying "2361 PL.pdf" and "2361 INV.pdf" — a packing list
 * and an invoice for PO 2361, which is exactly the mail this exists for.
 */

const LIST_URL = (emailId: string) => `https://api.resend.com/emails/receiving/${emailId}/attachments`

/**
 * Total bytes we will re-attach to one forward.
 *
 * Resend accepts 40MB on a send, but the forward has to ARRIVE, and Gmail
 * rejects anything over 25MB — the recipients' limit is the binding one, not
 * ours. 20MB leaves room for the body and encoding overhead.
 *
 * Sized from a real message: the Staples mail carried two phone photos,
 * 8.6MB and 9.8MB. A 12MB cap dropped one of them, which is not an edge case
 * — it is what a phone camera does. Anything still over is named in the body
 * rather than dropped silently.
 */
const MAX_TOTAL_BYTES = 20 * 1024 * 1024

export type InboundAttachmentMeta = {
  id: string
  filename: string
  content_type: string
  content_disposition: string | null
  size: number
}

export type FetchedAttachments = {
  /** Ready to hand to sendEmail. */
  files: Array<{ filename: string; content: Buffer }>
  /** Named but not carried — too big, or the download failed. Say so in the body. */
  omitted: Array<{ filename: string; why: string }>
}

/**
 * Inline parts are not attachments in any sense a person means.
 *
 * Every corporate signature carries its logo as an inline image — the stored
 * mail from RichLine and from Brandon's own forwards both contain an
 * "image001.png" that is a footer graphic. Re-attaching those makes every
 * forward look like it has files on it and buries the one that matters.
 * content_disposition is the honest discriminator: the real photos in the
 * Staples mail came through as "attachment" even though they also carried a
 * content_id, so keying on content_id would have dropped them.
 */
const isRealAttachment = (a: InboundAttachmentMeta) =>
  (a.content_disposition ?? 'attachment').toLowerCase() !== 'inline'

export async function fetchInboundAttachments(
  emailId: string,
  metaFromWebhook: InboundAttachmentMeta[] = [],
): Promise<FetchedAttachments> {
  const empty: FetchedAttachments = { files: [], omitted: [] }
  const key = process.env.RESEND_API_KEY
  if (!key) return empty

  // The webhook's own list is enough to know whether to bother calling at all.
  if (metaFromWebhook.length && !metaFromWebhook.some(isRealAttachment)) return empty

  let list: InboundAttachmentMeta[] & Array<{ download_url?: string }>
  try {
    const res = await fetch(LIST_URL(emailId), { headers: { Authorization: `Bearer ${key}` } })
    if (!res.ok) {
      return {
        files: [],
        omitted: metaFromWebhook.filter(isRealAttachment)
          .map((a) => ({ filename: a.filename, why: 'could not be fetched' })),
      }
    }
    const body = (await res.json()) as { data?: typeof list }
    list = body.data ?? ([] as never)
  } catch {
    return {
      files: [],
      omitted: metaFromWebhook.filter(isRealAttachment)
        .map((a) => ({ filename: a.filename, why: 'could not be fetched' })),
    }
  }

  const out: FetchedAttachments = { files: [], omitted: [] }
  let budget = MAX_TOTAL_BYTES

  for (const a of list) {
    if (!isRealAttachment(a)) continue
    if (a.size > budget) {
      // Say which of the two it actually was. "8.6MB — too large to forward"
      // on a file that would fit perfectly well on its own is a lie, and the
      // person reading it goes looking for a problem with the file.
      const mb = (a.size / 1024 / 1024).toFixed(1)
      out.omitted.push({
        filename: a.filename,
        why: a.size > MAX_TOTAL_BYTES
          ? `${mb}MB, too big to email`
          : `${mb}MB, would have pushed this mail over the size limit`,
      })
      continue
    }
    if (!a.download_url) {
      out.omitted.push({ filename: a.filename, why: 'no download link' })
      continue
    }
    try {
      // The signed URL is the file itself — no Authorization header, and it
      // stops working within the hour, which is why this is not cached.
      const r = await fetch(a.download_url)
      if (!r.ok) { out.omitted.push({ filename: a.filename, why: `download failed (${r.status})` }); continue }
      const buf = Buffer.from(await r.arrayBuffer())
      budget -= buf.byteLength
      out.files.push({ filename: a.filename, content: buf })
    } catch {
      out.omitted.push({ filename: a.filename, why: 'download failed' })
    }
  }
  return out
}
