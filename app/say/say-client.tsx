'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * The home-screen door.
 *
 * One screen, one box, one button, nothing to navigate. Brandon, 21 Sept 2026:
 * "the more friction that exists, the less Mouse will get updated." Every
 * decision here is that sentence — no nav, no login once the link is saved,
 * no thread to pick, no category to choose, no confirm step.
 *
 * DICTATION IS THE PHONE'S JOB, NOT THIS PAGE'S. Safari on iOS has no reliable
 * Web Speech API, and the iPhone is the phone this is for, so the design leans
 * on the thing every phone already has: a text box that opens the keyboard,
 * where the microphone key sits under your thumb. Where the browser does offer
 * speech recognition (Chrome on Android), a mic button appears as well. Either
 * way the words land in the same box and go to the same place.
 */

const STORE = 'cleo_say_token'

type Sent = { spoken: string; recorded: string[] } | { error: string }

// Chrome exposes this prefixed and TypeScript's DOM lib does not know it.
type SpeechCtor = new () => {
  continuous: boolean
  interimResults: boolean
  lang: string
  start: () => void
  stop: () => void
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
}

export function SayClient() {
  const [token, setToken] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState<Sent | null>(null)
  const [listening, setListening] = useState(false)
  const boxRef = useRef<HTMLTextAreaElement>(null)
  const speechRef = useRef<InstanceType<SpeechCtor> | null>(null)

  // THE TOKEN STAYS IN THE URL. It used to be stripped on first open, tidily,
  // and that was wrong in a way that only shows up on a phone.
  //
  // Add to Home Screen saves the address you are standing on. Strip the token
  // first and the saved icon is a bare /say that knows nobody, which is
  // exactly what Brandon hit: "the link doesn't seem to have anything in it to
  // differentiate users." localStorage was supposed to cover that, and cannot
  // be relied on to — an iOS home-screen web app does not dependably share
  // storage with the Safari tab it was created from, so the icon can open to
  // "not set up on this phone" on the very phone that just set it up.
  //
  // So the address keeps the secret, which is how a standalone app with no
  // login knows who is holding it. It is on their own phone, it was sent to
  // them the way a password is sent, and it is revoked from the Phones page
  // the moment anyone wants it gone. localStorage is still written, as the
  // fallback for somebody who opens a bare /say in a browser they used before.
  useEffect(() => {
    const fromLink = new URL(window.location.href).searchParams.get('k')
    if (fromLink) {
      try {
        localStorage.setItem(STORE, fromLink)
      } catch {
        /* Private mode. The URL still carries it, so this visit works. */
      }
      setToken(fromLink)
      return
    }
    try {
      setToken(localStorage.getItem(STORE))
    } catch {
      setToken(null)
    }
  }, [])

  useEffect(() => {
    const w = window as unknown as { webkitSpeechRecognition?: SpeechCtor; SpeechRecognition?: SpeechCtor }
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition
    if (!Ctor) return
    const rec = new Ctor()
    rec.continuous = true
    rec.interimResults = false
    rec.lang = 'en-US'
    rec.onresult = (e) => {
      let heard = ''
      for (let i = 0; i < e.results.length; i++) heard += e.results[i][0].transcript
      setText(heard.trim())
    }
    rec.onend = () => setListening(false)
    rec.onerror = () => setListening(false)
    speechRef.current = rec
    return () => rec.stop()
  }, [])

  async function send() {
    const body = text.trim()
    if (!body || sending || !token) return
    setSending(true)
    setSent(null)
    try {
      const res = await fetch('/api/say', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ text: body }),
      })
      if (res.status === 401) {
        setSent({ error: 'This phone is not set up. Ask Brandon for a fresh link.' })
        return
      }
      const data = (await res.json()) as { spoken?: string; recorded?: string[] }
      setSent({ spoken: data.spoken ?? 'Got it.', recorded: data.recorded ?? [] })
      setText('')
    } catch {
      // Never clear the box on a failure — whatever they said is still in it,
      // and losing a dictated sentence to a dropped signal in a car park is
      // exactly the friction this page exists to remove.
      setSent({ error: 'That did not send. You are probably out of signal — it is still here, try again.' })
    } finally {
      setSending(false)
    }
  }

  if (token === null) {
    return (
      <div className="mx-auto max-w-md px-5 py-16 text-center">
        <h1 className="text-xl font-semibold">Not set up on this phone</h1>
        <p className="mt-3 text-sm text-faint">
          This page needs a personal link before it can tell Mouse anything. Ask Brandon to send
          you one, open it once on this phone, and it will remember.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pb-8 pt-10">
      <h1 className="text-2xl font-semibold tracking-tight">Tell Mouse</h1>
      <p className="mt-1 text-sm text-faint">
        Anything that happened. It gets written down and Mouse will ask if something is unclear.
      </p>

      <textarea
        ref={boxRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        autoFocus
        rows={6}
        enterKeyHint="done"
        placeholder="The second batch of cotton arrived at Antonio's…"
        className="mt-5 w-full flex-1 resize-none rounded-2xl border border-line bg-surface px-4 py-4 text-lg leading-relaxed outline-none focus:border-accent"
      />

      <p className="mt-2 text-xs text-faint">
        Tap the microphone on your keyboard to talk instead of typing.
      </p>

      <div className="mt-4 flex gap-3">
        {speechRef.current ? (
          <button
            type="button"
            onClick={() => {
              const rec = speechRef.current
              if (!rec) return
              if (listening) {
                rec.stop()
                setListening(false)
              } else {
                setListening(true)
                rec.start()
              }
            }}
            className={`flex-shrink-0 rounded-2xl border px-5 py-4 text-base font-medium ${
              listening ? 'border-urgent bg-urgent-soft text-urgent' : 'border-line bg-surface'
            }`}
          >
            {listening ? 'Stop' : 'Talk'}
          </button>
        ) : null}

        <button
          type="button"
          onClick={send}
          disabled={!text.trim() || sending}
          className="flex-1 rounded-2xl bg-accent px-5 py-4 text-base font-semibold text-white disabled:opacity-40 dark:text-[#0F1211]"
        >
          {sending ? 'Telling Mouse…' : 'Send'}
        </button>
      </div>

      {sent ? (
        <div
          className={`mt-5 rounded-2xl border px-4 py-4 text-sm ${
            'error' in sent ? 'border-urgent bg-urgent-soft text-urgent' : 'border-line bg-sunk'
          }`}
        >
          {'error' in sent ? (
            sent.error
          ) : (
            <>
              <p className="leading-relaxed">{sent.spoken}</p>
              {/* Say plainly whether anything was actually written. A reply
                  that sounds satisfied while nothing reached the record is
                  the failure this project keeps meeting. */}
              {sent.recorded.length ? (
                <ul className="mt-3 space-y-1 border-t border-line pt-3 text-xs text-faint">
                  {sent.recorded.map((w, i) => (
                    <li key={i}>✓ {w}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 border-t border-line pt-3 text-xs text-faint">
                  Nothing was written down for this one.
                </p>
              )}
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}
