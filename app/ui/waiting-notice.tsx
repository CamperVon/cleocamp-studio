'use client'
import { useState, useTransition } from 'react'
import { previewWaiting, sendWaitingChunk, testWaiting, type NoticeInput } from '@/app/(main)/special/actions'
import { NOTICE_PICTURES, noticeImageUrl, noticePicture } from '@/lib/notice-pictures'

type Preview = { waiting: number; alreadySent: number; toSend: number; orders: string[]; sample: { to: string; order: string; text: string } | null }

const field = 'w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm'
const button = 'rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-40'

/**
 * Check who gets it, send yourself a test, then send to everyone, in that
 * order. Changing any wording clears the check, so what is sent is always
 * what was last previewed. See lib/waiting-notice.ts.
 */
export function WaitingNotice() {
  const [input, setInput] = useState<NoticeInput>({ product: 'Cleo Tee', colours: 'Black, White', subject: '', message: '', picture: '' })
  const [preview, setPreview] = useState<Preview | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ sent: number; failed: string[]; remaining: number } | null>(null)
  const [pending, start] = useTransition()

  const picture = noticePicture(input.picture)

  const set = (k: keyof NoticeInput) => (e: { target: { value: string } }) => {
    setInput({ ...input, [k]: e.target.value })
    setPreview(null)
    setProgress(null)
  }

  function check() {
    setNote(null)
    start(async () => {
      const r = await previewWaiting(input)
      if ('error' in r) setNote(r.error ?? null)
      else setPreview(r.preview)
    })
  }

  function test() {
    setNote(null)
    start(async () => {
      const r = await testWaiting(input)
      setNote('error' in r ? (r.error ?? null) : r.ok)
    })
  }

  function sendAll() {
    if (!preview || !preview.toSend) return
    if (!window.confirm(`Email ${preview.toSend} customer${preview.toSend === 1 ? '' : 's'} now? This cannot be undone.`)) return
    setNote(null)
    start(async () => {
      let total = { sent: 0, failed: [] as string[], remaining: preview.toSend }
      setProgress(total)
      // Twenty or so per request, until none are left or one round sends nothing.
      for (let round = 0; round < 40 && total.remaining > 0; round++) {
        const r = await sendWaitingChunk(input)
        if ('error' in r) { setNote(r.error ?? null); break }
        total = { sent: total.sent + r.chunk.sent, failed: [...total.failed, ...r.chunk.failed], remaining: r.chunk.remaining }
        setProgress(total)
        if (r.chunk.sent === 0 && r.chunk.failed.length === 0) break
      }
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-xl border border-line p-4">
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-muted">Product<input className={field} value={input.product} onChange={set('product')} /></label>
          <label className="text-xs text-muted">Colours<input className={field} value={input.colours} onChange={set('colours')} /></label>
        </div>
        <label className="text-xs text-muted">Subject<input className={field} value={input.subject} onChange={set('subject')} placeholder="Your Cleo Tee ships Friday" /></label>
        <label className="text-xs text-muted">
          Message
          <textarea className={`${field} min-h-56`} value={input.message} onChange={set('message')} />
        </label>
        <label className="text-xs text-muted">
          Pictures below the words
          <select className={field} value={input.picture} onChange={set('picture')}>
            <option value="">None, words only</option>
            {NOTICE_PICTURES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
        <p className="text-xs text-faint">
          Sent exactly as written. Optional: {'{first_name}'}, {'{order}'} and {'{items}'} are filled in for each customer,
          e.g. &ldquo;Hi {'{first_name}'}, your {'{items}'} (order {'{order}'}) ships Friday.&rdquo; Replies go to support@.
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={pending} onClick={check} className={`${button} bg-ink text-bg`}>
            {pending && !progress ? 'Working…' : 'Check who gets it'}
          </button>
          <button type="button" disabled={pending || !preview?.sample} onClick={test} className={`${button} border border-line text-muted hover:bg-sunk`}>
            Send me a test
          </button>
        </div>
        {note ? <p className="text-sm text-muted">{note}</p> : null}
      </div>

      {preview ? (
        <div className="flex flex-col gap-3 rounded-xl border border-line p-4">
          <p className="text-sm">
            <b>{preview.waiting}</b> order{preview.waiting === 1 ? ' is' : 's are'} still waiting.
            {preview.alreadySent ? ` ${preview.alreadySent} already got this email.` : ''} This will email <b>{preview.toSend}</b>.
          </p>
          {preview.sample ? (
            <div className="rounded-lg border border-line bg-sunk p-3">
              <p className="text-[11px] uppercase tracking-wider text-faint">What {preview.sample.order} gets ({preview.sample.to})</p>
              <p className="mt-1 text-sm font-medium">{input.subject}</p>
              <p className="mt-1 whitespace-pre-wrap text-sm">{preview.sample.text}</p>
              {picture?.images.map((img) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={img.cid} src={noticeImageUrl(img)} alt={img.alt} style={{ maxWidth: img.width }} className="mt-3 block h-auto w-full" />
              ))}
            </div>
          ) : null}
          {preview.orders.length ? (
            <details>
              <summary className="cursor-pointer text-sm text-muted">The {preview.orders.length} orders</summary>
              <ul className="mt-2 flex flex-col gap-0.5 text-xs text-muted">
                {preview.orders.map((o) => <li key={o}>{o}</li>)}
              </ul>
            </details>
          ) : null}
          <button
            type="button"
            disabled={pending || !preview.toSend}
            onClick={sendAll}
            className={`${button} self-start bg-urgent text-white`}
          >
            {preview.toSend ? `Send to ${preview.toSend} customers` : 'Nobody left to send to'}
          </button>
          {progress ? (
            <p className="text-sm">
              {progress.sent} sent{progress.remaining ? `, ${progress.remaining} to go` : ', all done'}.
              {progress.failed.length ? ` Not sent: ${progress.failed.join(', ')} (tap send again to retry them).` : ''}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
