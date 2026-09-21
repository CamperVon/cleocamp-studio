'use client'

import { useState } from 'react'
import { Chip } from '@/app/ui/primitives'

type Minted = { link: string; siri: { url: string; header: string }; replaced: boolean }

/**
 * One person's row.
 *
 * The link appears here and nowhere else, once, and is gone on the next page
 * load — it is not stored anywhere it could be read back, so there is no
 * "show it again". Losing it costs one more tap on this button.
 */
export function PhoneSetup({
  personId,
  name,
  role,
  alreadySetUp,
}: {
  personId: string
  name: string
  role: string | null
  alreadySetUp: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [minted, setMinted] = useState<Minted | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [setUp, setSetUp] = useState(alreadySetUp)

  async function create() {
    if (busy) return
    if (setUp && !confirm(`${name} already has a phone set up. Making a new link switches the old one off straight away. Carry on?`)) return
    setBusy(true)
    try {
      const res = await fetch('/api/say-links', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ personId }),
      })
      if (res.ok) {
        setMinted((await res.json()) as Minted)
        setSetUp(true)
      }
    } finally {
      setBusy(false)
    }
  }

  async function revoke() {
    if (!confirm(`Switch off ${name}'s phone? They will not be able to tell Mouse anything until you send a new link.`)) return
    setBusy(true)
    try {
      await fetch('/api/say-links', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ personId }),
      })
      setSetUp(false)
      setMinted(null)
    } finally {
      setBusy(false)
    }
  }

  const copy = async (what: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(what)
      setTimeout(() => setCopied(null), 1800)
    } catch {
      /* No clipboard permission — the text is on screen to select by hand. */
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium">{name}</span>
            {setUp ? <Chip tone="accent">set up</Chip> : null}
          </div>
          {role ? <div className="mt-0.5 text-xs text-faint">{role}</div> : null}
        </div>
        <div className="flex gap-2">
          {setUp ? (
            <button
              type="button"
              onClick={revoke}
              disabled={busy}
              className="rounded-lg border border-line px-3 py-2 text-sm disabled:opacity-40"
            >
              Switch off
            </button>
          ) : null}
          <button
            type="button"
            onClick={create}
            disabled={busy}
            className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-40 dark:text-[#0F1211]"
          >
            {busy ? 'Working…' : setUp ? 'New link' : 'Create link'}
          </button>
        </div>
      </div>

      {minted ? (
        <div className="mt-4 space-y-4 rounded-xl border border-line bg-sunk px-4 py-4">
          <p className="text-xs text-faint">
            Shown once. It is not saved anywhere you can read it back, so if it gets lost just
            make another.
            {minted.replaced ? ' The previous link stopped working just now.' : ''}
          </p>

          <div>
            <div className="text-xs font-medium">Send {name} this link</div>
            <div className="mt-1 break-all rounded-lg bg-surface px-3 py-2 font-mono text-xs">
              {minted.link}
            </div>
            <button
              type="button"
              onClick={() => copy('link', minted.link)}
              className="mt-2 rounded-lg border border-line px-3 py-1.5 text-xs"
            >
              {copied === 'link' ? 'Copied' : 'Copy link'}
            </button>
            <p className="mt-2 text-xs text-faint">
              They open it once on their phone, then Share → Add to Home Screen.
            </p>
          </div>

          <div className="border-t border-line pt-3">
            <div className="text-xs font-medium">Or for &ldquo;Hey Siri, tell Mouse&rdquo;</div>
            <p className="mt-1 text-xs text-faint">
              Shortcuts app → new shortcut → Dictate Text, then Get Contents of URL, set to POST
              with these, then Speak Text on the result.
            </p>
            <div className="mt-2 break-all rounded-lg bg-surface px-3 py-2 font-mono text-xs">
              {minted.siri.url}
            </div>
            <div className="mt-1 break-all rounded-lg bg-surface px-3 py-2 font-mono text-xs">
              Authorization: {minted.siri.header}
            </div>
            <button
              type="button"
              onClick={() => copy('siri', `${minted.siri.url}\nAuthorization: ${minted.siri.header}`)}
              className="mt-2 rounded-lg border border-line px-3 py-1.5 text-xs"
            >
              {copied === 'siri' ? 'Copied' : 'Copy both'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
