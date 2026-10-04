/**
 * Pictures that can go in a Special email, below the words. Brandon, 4 Oct
 * 2026: Cleo's note to everyone waiting on a Cleo Tee ends with her
 * handwritten signature and a collage of the studio, the packing and the
 * post office runs.
 *
 * A fixed list, picked by id, so the page can never name a file of its own.
 * The files live in public/notice/ (so the page can show them) and are read
 * from disk at send time (lib/waiting-notice.ts); next.config.ts traces them into the Special
 * route, as it already does for the PO PDF fonts. They go in the email as
 * inline attachments (cid:), not links: a linked picture is blocked by
 * default in some mail apps, an attached one shows.
 */
export type NoticeImage = { file: string; cid: string; alt: string; width: number }
export type NoticePicture = { id: string; label: string; images: NoticeImage[] }

// Cleo's signature and the packing collage for the Cleo Tee email go here
// once the photos are in (public/notice/cleo-signature.png,
// public/notice/cleo-tee-collage.jpg).
export const NOTICE_PICTURES: NoticePicture[] = [
]

export function noticePicture(id: string | null | undefined): NoticePicture | null {
  return NOTICE_PICTURES.find((p) => p.id === id) ?? null
}

export const noticeImageUrl = (img: NoticeImage) => `/notice/${img.file}`

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * The email as HTML: Cleo's words exactly as the plain-text part has them,
 * a paragraph per blank line, then the pictures below. Pure.
 */
export function noticeHtml(text: string, p: NoticePicture | null): string {
  const paras = text.split(/\n\s*\n/).map((para) => para.trim()).filter(Boolean)
    .map((para) => `<p style="margin:0 0 16px">${escape(para).replace(/\n/g, '<br>')}</p>`)
  const imgs = (p?.images ?? []).map((img) =>
    `<img src="cid:${img.cid}" alt="${escape(img.alt)}" width="${img.width}" style="display:block;border:0;width:100%;max-width:${img.width}px;height:auto;margin:8px 0 20px">`)
  return `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1a1a1a;max-width:600px">${paras.join('')}${imgs.join('')}</div>`
}
