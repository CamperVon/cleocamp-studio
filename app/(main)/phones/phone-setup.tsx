'use client'

import { useState } from 'react'

/**
 * One person's row: their two links, on screen, and the buttons to replace or
 * switch them off.
 *
 * Rendered from the token the page already loaded rather than fetched on a
 * click, so they are simply there when the page is. See page.tsx for why they
 * stopped being held back from the person who has the admin password anyway.
 */
export function PhoneSetup({
  personId,
  name,
  role,
  origin,
  token,
}: {
  personId: string
  name: string
  role: string | null
  origin: string
  token: string | null
}) {
  const [busy, setBusy] = useState(false)
  const [live, setLive] = useState(token)
  const [copied, setCopied] = useState<string | null>(null)

  const links = live
    ? {
        phone: `${origin}/enter?k=${live}&to=say`,
        computer: `${origin}/enter?k=${live}`,
        // The secret rides in the URL rather than an Authorization header.
        // The endpoint reads either, and the header screen in Shortcuts is
        // buried behind Show More and asks for a name and value in two
        // separate boxes — Brandon, 21 Sept 2026: "i don't see where you add
        // new header name and value." A URL somebody can paste in one go
        // removes the step instead of explaining it better.
        siri: `${origin}/api/say?format=text&k=${live}`,
      }
    : null

  async function replace() {
    if (busy) return
    if (
      live &&
      !confirm(
        `${name} already has links. New ones switch the old ones off straight away, phone and computer both, and they will need sending the new ones. Carry on?`,
      )
    ) {
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/say-links', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ personId }),
      })
      if (res.ok) {
        const data = (await res.json()) as { desktopLink: string }
        // Read the new token back off the link we were handed, so the row
        // updates without a page reload.
        setLive(new URL(data.desktopLink).searchParams.get('k'))
      }
    } finally {
      setBusy(false)
    }
  }

  async function revoke() {
    if (!confirm(`Switch off ${name}'s links? Both devices stop working until you send new ones.`)) return
    setBusy(true)
    try {
      await fetch('/api/say-links', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ personId }),
      })
      setLive(null)
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

  const Row = ({ id, label, value, note }: { id: string; label: string; value: string; note?: string }) => (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-medium">{label}</span>
        <button
          type="button"
          onClick={() => copy(id, value)}
          className="shrink-0 text-xs text-faint hover:text-ink"
        >
          {copied === id ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className="mt-1 break-all rounded-lg bg-surface px-3 py-2 font-mono text-[11px] leading-relaxed">
        {value}
      </div>
      {note ? <p className="mt-1 text-xs text-faint">{note}</p> : null}
    </div>
  )

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="font-medium">{name}</span>
          {role ? <div className="mt-0.5 text-xs text-faint">{role}</div> : null}
        </div>
        <div className="flex gap-2">
          {live ? (
            <button
              type="button"
              onClick={revoke}
              disabled={busy}
              className="rounded-lg border border-line px-3 py-2 text-sm text-faint disabled:opacity-40"
            >
              Switch off
            </button>
          ) : null}
          <button
            type="button"
            onClick={replace}
            disabled={busy}
            className={
              live
                ? 'rounded-lg border border-line px-3 py-2 text-sm disabled:opacity-40'
                : 'rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-40 dark:text-[#0F1211]'
            }
          >
            {busy ? 'Working…' : live ? 'Replace' : 'Create links'}
          </button>
        </div>
      </div>

      {links ? (
        <div className="mt-3 space-y-3 rounded-xl border border-line bg-sunk px-4 py-4">
          <Row
            id={`${personId}-phone`}
            label="Phone"
            value={links.phone}
            note="Open on their phone, then Share → Add to Home Screen from that page. It comes up named Say Cheese."
          />
          <Row
            id={`${personId}-computer`}
            label="Computer"
            value={links.computer}
            note="Open once in their browser. Signs them in as themselves for a month."
          />
          <details className="text-xs">
            <summary className="cursor-pointer text-faint">
              Siri, if they want it &mdash; &ldquo;Hey Siri, tell Mouse&rdquo;
            </summary>
            <div className="mt-3 space-y-3">
              <p className="text-faint">
                Optional. The home screen icon already does all of this &mdash; Siri only saves
                getting the phone out.
              </p>
              <ol className="list-decimal space-y-1.5 pl-4 text-faint">
                <li>Shortcuts app → <span className="text-ink">+</span></li>
                <li>Search <span className="text-ink">Dictate Text</span>, add it</li>
                <li>Search <span className="text-ink">Get Contents of URL</span>, add it</li>
                <li>Paste the URL below into its URL box</li>
                <li>Tap <span className="text-ink">Show More</span> on that action</li>
                <li>Method → <span className="text-ink">POST</span></li>
                <li>
                  Request Body → <span className="text-ink">JSON</span> → add one field, named{' '}
                  <code className="text-ink">text</code>, whose value is the{' '}
                  <span className="text-ink">Dictated Text</span> variable
                </li>
                <li>Search <span className="text-ink">Speak Text</span>, add it</li>
                <li>
                  Name the shortcut <span className="text-ink">Say Cheese</span>, then say
                  &ldquo;Hey Siri, Say Cheese&rdquo;
                </li>
              </ol>
              {/* NOT "Tell Mouse". Siri owns "tell <someone> <something>" as a
                  messaging command, and a contact called Mouse wins it: on
                  21 Sept 2026 that sent an empty text to the Mouse contact,
                  which arrived in the inbox through T-Mobile's SMS-to-email
                  gateway and got raised as a question. The shortcut never ran.
                  A name that is not a verb plus a contact cannot be hijacked
                  that way, and it matches the home screen icon. */}
              <p className="text-faint">
                Do not call it &ldquo;Tell Mouse&rdquo;. Siri reads &ldquo;tell&rdquo; plus a name
                as an instruction to message that person, so if there is a Mouse in the contacts it
                sends them a text instead of running the shortcut.
              </p>
              <Row id={`${personId}-siri`} label="URL (step 4)" value={links.siri} />
              <p className="text-faint">
                No headers to set &mdash; this URL carries the key. If Form or File is easier to
                reach than JSON in step 7, either works.
              </p>
            </div>
          </details>
        </div>
      ) : null}
    </div>
  )
}
