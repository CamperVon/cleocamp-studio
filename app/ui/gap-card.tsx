'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { dismissItem } from '@/app/(main)/items/actions'
import type { PackagedGap } from '@/lib/gap'

/**
 * One gap report, with the exchange that produced it.
 *
 * Collapsed by default — the list is for scanning, and an unfolded transcript
 * per row makes the page unreadable at the exact moment someone is trying to
 * see how many are outstanding.
 *
 * The copy button is the bridge. Claude Code sessions start cold; pasting this
 * into one is the difference between "Mouse couldn't make a variant" and the
 * actual exchange with the tool calls attached.
 */
export function GapCard({ gap }: { gap: PackagedGap }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  // Dismiss closes it like any other ToDo item: already fixed, or not worth
  // fixing (Brandon, 4 Oct 2026: "we need to be able to dismiss For Claude
  // entries"). It goes from the list; the record stays, marked dismissed.
  const [pending, start] = useTransition()
  const [dismissed, setDismissed] = useState(false)
  const router = useRouter()

  async function copy() {
    try {
      await navigator.clipboard.writeText(gap.asText)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard is blocked outside a secure context and in some embedded
      // browsers. Opening the transcript at least leaves it selectable by
      // hand rather than failing silently.
      setOpen(true)
    }
  }

  return (
    <li className="px-4 py-3.5 sm:px-5">
      <p className="text-sm font-medium">{gap.title}</p>
      {gap.note ? <p className="mt-0.5 text-sm text-muted">Wanted: {gap.note}</p> : null}
      <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px] text-faint">
        <span>
          {gap.reportedAt.toLocaleDateString('en-US', {
            timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric',
          })}
        </span>
        {gap.exchange ? (
          <button type="button" className="underline" onClick={() => setOpen((o) => !o)}>
            {open ? 'Hide the exchange' : `Show the exchange (${gap.exchange.length})`}
          </button>
        ) : (
          <span>the chat this came from is gone</span>
        )}
        <button type="button" className="underline" onClick={copy}>
          {copied ? 'Copied' : 'Copy for Claude'}
        </button>
        <button
          type="button"
          disabled={pending || dismissed}
          onClick={() => start(async () => { await dismissItem(gap.id); setDismissed(true); router.refresh() })}
          className="ml-auto rounded-lg border border-line px-3 py-1.5 text-xs text-muted hover:bg-sunk disabled:opacity-40"
        >
          {dismissed ? 'Dismissed' : pending ? 'Dismissing…' : 'Dismiss'}
        </button>
      </div>

      {open && gap.exchange ? (
        <div className="mt-2.5 flex flex-col gap-2 rounded border border-line bg-sunk p-3">
          {gap.exchange.map((m, i) => (
            <div key={i} className={m.isTheReportedReply ? 'border-l-2 border-accent pl-2.5' : 'pl-2.5'}>
              <p className="text-[10px] uppercase tracking-wider text-faint">
                {m.role === 'user' ? 'Person' : 'Mouse'}
                {m.isTheReportedReply ? ' · reported' : ''}
              </p>
              <p className="whitespace-pre-wrap text-[12px] leading-relaxed">{m.text}</p>
              {m.tools.length ? (
                <p className="mt-1 text-[11px] text-muted">
                  {m.tools.map((t) => t.name).join(', ')}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </li>
  )
}
