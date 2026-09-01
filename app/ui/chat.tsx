'use client'
import { useState, useRef, useEffect } from 'react'
import { Mouse } from './mouse'

type Msg = {
  role: 'user' | 'assistant'
  text: string
  writes?: Array<{ tool: string; summary: string }>
  model?: string
}

const LABEL: Record<string, string> = {
  log_inventory_event: 'logged', correct_inventory_event: 'corrected',
  raise_question: 'noted a question', resolve_question: 'answered',
  create_todo: 'added a todo', add_note: 'noted',
  update_component: 'updated', update_product: 'updated',
  upsert_bom_line: 'set per-unit',
}

export function Chat() {
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [pending, setPending] = useState<string | null>(null)
  const [threadId, setThreadId] = useState<string | undefined>()
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, pending])

  async function send(e: React.FormEvent) {
    e.preventDefault()
    const text = input.trim()
    if (!text || pending) return
    setInput('')
    setMessages((m) => [...m, { role: 'user', text }])
    setPending('Thinking')

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId, message: text }),
      })
      if (!res.ok) throw new Error(`${res.status}`)
      const d = await res.json()
      setThreadId(d.threadId)
      setMessages((m) => [...m, { role: 'assistant', text: d.reply, writes: d.writes, model: d.model }])
    } catch {
      setMessages((m) => [...m, {
        role: 'assistant',
        text: "Something went wrong reaching me just then. Nothing was saved — try again.",
      }])
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="flex flex-col">
      <div className="max-h-[22rem] overflow-y-auto px-4 py-3 sm:px-5">
        {messages.length === 0 ? (
          <div className="flex items-center gap-3 py-1">
            <Mouse size={30} className="shrink-0 text-faint" />
            <p className="text-sm text-muted">
              Tell me what happened and I&rsquo;ll keep track. &ldquo;Shipped 5 large pinks to
              Caf&eacute; Forgot&rdquo;, or ask what&rsquo;s running low.
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
                    {m.text}
                  </p>
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

      <form onSubmit={send} className="flex gap-2 border-t border-line p-3 sm:px-5">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="What happened?"
          disabled={!!pending}
          className="min-w-0 flex-1 rounded-lg border border-line bg-bg px-3.5 py-2.5 text-base
                     outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25"
        />
        <button
          type="submit"
          disabled={!!pending || !input.trim()}
          className="shrink-0 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white
                     disabled:opacity-40 dark:text-[#0F1211]"
        >
          Send
        </button>
      </form>
    </div>
  )
}
