'use client'
import { useState, useRef, useEffect, type ReactNode } from 'react'
import { Mouse } from './mouse'

type Msg = {
  role: 'user' | 'assistant'
  text: string
  writes?: Array<{ tool: string; summary: string }>
  model?: string
  attachments?: Array<{ filename: string }>
}

type PendingFile = { filename: string; mediaType: string; base64: string }

// Mouse writes in plain prose but reaches for **bold** and bare paths like
// /po/2359 when something is worth pointing at directly. Rendered as inert
// text those are just asterisks and dead words — this turns the two into a
// real <strong> and a real clickable link, without pulling in a markdown
// library for what amounts to two patterns.
const INLINE = /(\*\*[^*]+\*\*)|(https?:\/\/[^\s)]+)|(\/(?:po|products|components|vendors|finances|inbox|items)(?:\/[A-Za-z0-9._-]+)*)/g

// A link at the end of a sentence pulls the full stop in with it otherwise —
// "see /po/2359." would point at "/po/2359." and 404.
const TRAILING_PUNCT = /[.,;:!?)\]]+$/

function renderMouseText(text: string) {
  const nodes: ReactNode[] = []
  let last = 0
  let key = 0
  for (const m of text.matchAll(INLINE)) {
    const start = m.index ?? 0
    if (start > last) nodes.push(text.slice(last, start))
    const [whole, bold, url, path] = m
    if (bold) {
      nodes.push(<strong key={key++}>{bold.slice(2, -2)}</strong>)
    } else {
      const raw = (url ?? path)!
      const trail = raw.match(TRAILING_PUNCT)?.[0] ?? ''
      const href = trail ? raw.slice(0, -trail.length) : raw
      nodes.push(
        <a key={key++} href={href} target="_blank" rel="noreferrer" className="underline">{href}</a>,
      )
      if (trail) nodes.push(trail)
    }
    last = start + whole.length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

const LABEL: Record<string, string> = {
  log_inventory_event: 'logged', correct_inventory_event: 'corrected',
  raise_question: 'noted a question', resolve_question: 'answered',
  create_todo: 'added a todo', add_note: 'noted',
  update_component: 'updated', update_product: 'updated',
  upsert_bom_line: 'set per-unit',
}

// Claude reads images natively and PDFs as documents — nothing else.
const ACCEPTED_TYPES = 'application/pdf,image/jpeg,image/png,image/webp'
const MAX_FILES = 3
const MAX_BYTES = 4 * 1024 * 1024

// Every turn is already saved server-side; this just remembers which thread
// belongs to this browser so leaving the page (or refreshing it) doesn't
// throw the conversation away — a resume, not a second copy of the data.
const THREAD_KEY = 'studio-mouse:thread-id'

export function Chat() {
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [pending, setPending] = useState<string | null>(null)
  const [threadId, setThreadId] = useState<string | undefined>()
  const [restoring, setRestoring] = useState(true)
  const [files, setFiles] = useState<PendingFile[]>([])
  const [fileError, setFileError] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, pending])

  // Resume the last conversation this browser had, once, on mount.
  useEffect(() => {
    let cancelled = false
    async function restore() {
      let saved: string | null = null
      try { saved = localStorage.getItem(THREAD_KEY) } catch { /* private window, etc. */ }
      if (!saved) { setRestoring(false); return }
      try {
        const res = await fetch(`/api/chat?threadId=${encodeURIComponent(saved)}`)
        if (!res.ok) throw new Error('gone')
        const d = await res.json()
        if (cancelled) return
        setMessages(d.messages)
        setThreadId(d.threadId)
      } catch {
        // Thread no longer exists, or couldn't be reached — start fresh
        // rather than getting stuck unable to send anything.
        try { localStorage.removeItem(THREAD_KEY) } catch { /* ignore */ }
      } finally {
        if (!cancelled) setRestoring(false)
      }
    }
    restore()
    return () => { cancelled = true }
  }, [])

  function rememberThread(id: string) {
    setThreadId(id)
    try { localStorage.setItem(THREAD_KEY, id) } catch { /* ignore */ }
  }

  // Clears the screen only. The old thread and every message in it stay in
  // the database exactly as they are — this just stops pointing at it, so
  // the next message starts a new one instead of picking the old one back up.
  function startNewConversation() {
    setMessages([])
    setThreadId(undefined)
    try { localStorage.removeItem(THREAD_KEY) } catch { /* ignore */ }
  }

  async function onFilesChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(e.target.files ?? [])
    e.target.value = '' // let picking the same file twice re-fire onChange
    if (!chosen.length) return
    setFileError(null)

    if (files.length + chosen.length > MAX_FILES) {
      setFileError(`Up to ${MAX_FILES} files at a time.`)
      return
    }
    for (const f of chosen) {
      if (!ACCEPTED_TYPES.split(',').includes(f.type)) {
        setFileError(`${f.name}: send a PDF, JPG, PNG or WEBP.`)
        return
      }
      if (f.size > MAX_BYTES) {
        setFileError(`${f.name} is too big — keep it under 4MB.`)
        return
      }
    }

    const read = (f: File) =>
      new Promise<PendingFile>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          const result = reader.result as string
          resolve({ filename: f.name, mediaType: f.type, base64: result.split(',')[1] ?? '' })
        }
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(f)
      })

    try {
      const read1 = await Promise.all(chosen.map(read))
      setFiles((prev) => [...prev, ...read1])
    } catch {
      setFileError("Couldn't read that file — try again.")
    }
  }

  function removeFile(i: number) {
    setFiles((prev) => prev.filter((_, j) => j !== i))
  }

  async function send(e: { preventDefault: () => void }) {
    e.preventDefault()
    const text = input.trim()
    if ((!text && files.length === 0) || pending) return
    setInput('')
    // Enter alone sent this, but the box had grown for a multi-line draft —
    // collapse it back rather than leaving a tall empty box behind.
    if (inputRef.current) inputRef.current.style.height = 'auto'
    const attached = files
    setFiles([])
    setMessages((m) => [
      ...m,
      { role: 'user', text: text || "Here's a document — take a look.", attachments: attached },
    ])
    setPending(attached.length ? 'Reading' : 'Thinking')

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId, message: text, attachments: attached }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error || `${res.status}`)
      }
      const d = await res.json()
      rememberThread(d.threadId)
      setMessages((m) => [...m, { role: 'assistant', text: d.reply, writes: d.writes, model: d.model }])
    } catch (err) {
      setMessages((m) => [...m, {
        role: 'assistant',
        text:
          err instanceof Error && err.message && !/^\d+$/.test(err.message)
            ? err.message
            : "Something went wrong reaching me just then. Nothing was saved — try again.",
      }])
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="flex flex-col">
      {messages.length > 0 ? (
        <div className="flex justify-end border-b border-line px-4 py-1.5 sm:px-5">
          <button
            type="button"
            onClick={startNewConversation}
            className="text-xs text-faint hover:text-ink"
          >
            New conversation
          </button>
        </div>
      ) : null}
      <div className="max-h-[65vh] min-h-[20rem] overflow-y-auto px-4 py-3 sm:max-h-[36rem] sm:px-5">
        {restoring ? null : messages.length === 0 ? (
          <div className="flex items-center gap-3 py-1">
            <Mouse size={30} className="shrink-0 text-faint" />
            <p className="text-sm text-muted">
              Tell me what happened and I&rsquo;ll keep track. &ldquo;Shipped 5 large pinks to
              Caf&eacute; Forgot&rdquo;, ask what&rsquo;s running low, or attach an invoice or old
              PO for me to read.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-4">
            {messages.map((m, i) => (
              <li key={i} className={m.role === 'user' ? 'flex justify-end' : ''}>
                <div className={m.role === 'user' ? 'max-w-[85%]' : 'w-full'}>
                  <p
                    className={
                      m.role === 'user'
                        ? 'rounded-2xl rounded-br-sm bg-accent px-3.5 py-2 text-sm text-white dark:text-[#0F1211]'
                        : 'whitespace-pre-wrap text-sm leading-relaxed'
                    }
                  >
                    {m.role === 'assistant' ? renderMouseText(m.text) : m.text}
                  </p>
                  {m.attachments?.length ? (
                    <ul className="mt-1.5 flex flex-wrap justify-end gap-1.5">
                      {m.attachments.map((a, j) => (
                        <li key={j} className="rounded bg-sunk px-1.5 py-0.5 text-[11px] text-muted">
                          📎 {a.filename}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {m.writes?.length ? (
                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {m.writes.map((w, j) => (
                        <li
                          key={j}
                          className="rounded bg-accent-soft px-1.5 py-0.5 text-[11px] font-medium text-accent"
                        >
                          {LABEL[w.tool] ?? w.tool}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {m.model === 'claude-opus-5' ? (
                    <p className="mt-1 text-[11px] text-faint">thought about this one properly</p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        {pending ? (
          <p className="mt-4 flex items-center gap-2 text-sm text-faint">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-faint" />
            {pending}&hellip;
          </p>
        ) : null}
        <div ref={endRef} />
      </div>

      <form onSubmit={send} className="border-t border-line p-3 sm:px-5">
        {files.length ? (
          <ul className="mb-2 flex flex-wrap gap-1.5">
            {files.map((f, i) => (
              <li
                key={i}
                className="flex items-center gap-1.5 rounded bg-sunk px-2 py-1 text-xs text-muted"
              >
                📎 <span className="max-w-[10rem] truncate">{f.filename}</span>
                <button
                  type="button"
                  onClick={() => removeFile(i)}
                  aria-label={`Remove ${f.filename}`}
                  className="text-faint hover:text-ink"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {fileError ? <p className="mb-2 text-xs text-warn">{fileError}</p> : null}

        <div className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_TYPES}
            multiple
            onChange={onFilesChosen}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={!!pending}
            aria-label="Attach a file"
            title="Attach an invoice or old PO"
            className="shrink-0 rounded-lg border border-line px-3.5 py-2.5 text-muted
                       hover:bg-sunk disabled:opacity-40"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21.44 11.05l-9.19 9.19a5 5 0 01-7.07-7.07l9.19-9.19a3.5 3.5 0 014.95 4.95l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
            </svg>
          </button>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              const el = e.target
              el.style.height = 'auto'
              el.style.height = `${Math.min(el.scrollHeight, 128)}px`
            }}
            onKeyDown={(e) => {
              // Enter sends; shift+enter writes a line the way it does
              // everywhere else. Still typing a word (IME composition)
              // shouldn't count as either.
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                send(e)
              }
            }}
            placeholder="What happened?"
            disabled={!!pending}
            rows={1}
            className="min-w-0 flex-1 resize-none rounded-lg border border-line bg-bg px-3.5 py-2.5
                       text-base leading-snug outline-none focus-visible:border-accent
                       focus-visible:ring-2 focus-visible:ring-accent/25"
          />
          <button
            type="submit"
            disabled={!!pending || (!input.trim() && files.length === 0)}
            className="shrink-0 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white
                       disabled:opacity-40 dark:text-[#0F1211]"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  )
}
