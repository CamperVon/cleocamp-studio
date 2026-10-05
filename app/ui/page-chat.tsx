'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { awaitReply, renderMouseText } from './chat'
import { MouseFace } from './mouse-face'

/** The pages that carry a box, as the server knows them (app/api/chat/route.ts). */
export type ChatPage = 'Products' | 'ToDo' | 'Stylists' | 'Wholesale'

type Reply = { text: string; writes?: Array<{ summary: string }> }

/**
 * "Tell Mouse" at the top of a page, for thoughts and notes about what is on
 * it. Brandon, 5 Oct 2026: "a chat box at the top of Products, ToDo,
 * Stylists, Wholesale so that we can give thoughts, notes, etc."
 *
 * It is the same Mouse as the chat on Home, told which page the words came
 * from, so it can file a note on the right product or account, add a todo,
 * or make the change, and say which. Each page keeps its own short
 * conversation (remembered in this browser), not the Home one, so a note
 * typed here never lands in a practice chat left open there. Mouse's
 * search_chat still finds all of it.
 */
export function PageChat({ page, placeholder }: { page: ChatPage; placeholder: string }) {
  const key = `studio-mouse:page-thread:${page}`
  const router = useRouter()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [reply, setReply] = useState<Reply | null>(null)
  const [error, setError] = useState<string | null>(null)
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  function threadId(): string {
    let id: string | null = null
    try { id = localStorage.getItem(key) } catch { /* private window */ }
    if (!id) {
      id = crypto.randomUUID()
      try { localStorage.setItem(key, id) } catch { /* ignore */ }
    }
    return id
  }

  async function send() {
    const message = text.trim()
    if (!message || busy) return
    setBusy(true)
    setError(null)
    setReply(null)
    const id = threadId()
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId: id, message, page }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw Object.assign(new Error(d.error ?? 'Mouse could not take that'), { shown: true })
      setReply({ text: d.reply || 'Done.', writes: d.writes })
      setText('')
      router.refresh()
    } catch (e) {
      if ((e as { shown?: boolean }).shown) { setError((e as Error).message); return }
      // The phone dropped the request; the turn may still finish on the server.
      const got = await awaitReply(id, message, () => alive.current)
      if (Array.isArray(got)) {
        const last = got[got.length - 1]
        setReply({ text: last?.role === 'assistant' ? last.text : 'Done.' })
        setText('')
        router.refresh()
      } else {
        setError(got === 'not-received' ? 'That did not reach Mouse. Send it again.' : 'Mouse is taking a while. Check back in a minute.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mb-4 rounded-xl border border-line bg-bg p-3">
      <div className="flex items-start gap-2">
        <MouseFace size={28} />
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send() }}
          rows={text.includes('\n') || text.length > 60 ? 3 : 1}
          placeholder={placeholder}
          aria-label={`Tell Mouse something about ${page}`}
          className="min-h-9 flex-1 resize-none rounded-lg border border-line bg-bg px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={send}
          disabled={busy || !text.trim()}
          className="shrink-0 rounded-lg bg-ink px-3 py-2 text-sm font-medium text-bg disabled:opacity-40"
        >
          {busy ? 'Thinking…' : 'Send'}
        </button>
      </div>
      {error ? <p className="mt-2 text-sm text-warn">{error}</p> : null}
      {reply ? (
        <div className="mt-2 rounded-lg bg-sunk px-3 py-2 text-sm">
          <div className="whitespace-pre-wrap">{renderMouseText(reply.text)}</div>
          {reply.writes?.length ? (
            <p className="mt-1 text-xs text-muted">{reply.writes.map((w) => w.summary).join(' · ')}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
