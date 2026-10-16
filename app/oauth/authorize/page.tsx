import Image from 'next/image'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { AUTHORIZE_KEYS, authorizeParams, checkAuthorize } from '@/lib/mcp/oauth'
import { isSignedIn } from '@/lib/session'
import { allow, deny } from './actions'
import { requestOrigin } from './origin'

export const dynamic = 'force-dynamic'

/**
 * The consent screen for the read-only Claude connector (lib/mcp/oauth.ts).
 * Outside proxy.ts's session check only so that a sign-in can come back here
 * with the whole request intact; it checks the session itself, and shows
 * nothing to anyone not signed in to this app.
 */
export default async function Authorize({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams
  const p = authorizeParams((k) => { const v = sp[k]; return typeof v === 'string' && v ? v : null })
  const qs = new URLSearchParams(AUTHORIZE_KEYS.flatMap((k) => (p[k] ? [[k, p[k]!]] : [])))
  if (!(await isSignedIn())) redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${qs}`)}`)
  const check = await checkAuthorize(db, p, await requestOrigin())

  return (
    <main className="flex min-h-dvh items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <Image src="/mouse/studio-mouse.jpg" alt="Studio Mouse" width={720} height={960} priority className="mb-6 h-auto w-28 rounded-2xl shadow-sm" />
        {check.ok ? (
          <>
            <h1 className="font-serif text-2xl italic text-ink">Let Claude read Studio Mouse?</h1>
            <p className="mt-3 text-sm text-muted">
              {check.clientName ? <><span className="font-medium text-ink">{check.clientName}</span> is asking. </> : null}
              Claude will be able to look up products, stock, prices, purchase orders, vendors, open questions, notes and the daily brief.
            </p>
            <p className="mt-2 text-sm text-muted">Looking things up changes nothing. When you ask it to, Claude can also tell Mouse something, and Mouse acts on it straight away as if you had typed it, or leave a request for Claude Code. It never sees customers&rsquo; contact details. You can disconnect it any time on the Claude Connector page.</p>
            <div className="mt-7 flex flex-col gap-3">
              <form action={allow}>
                {AUTHORIZE_KEYS.map((k) => (p[k] ? <input key={k} type="hidden" name={k} value={p[k]!} /> : null))}
                <button type="submit" className="w-full rounded-lg bg-ink px-4 py-3 text-base font-medium text-bg">Allow</button>
              </form>
              <form action={deny}>
                {AUTHORIZE_KEYS.map((k) => (p[k] ? <input key={k} type="hidden" name={k} value={p[k]!} /> : null))}
                <button type="submit" className="w-full rounded-lg border border-line px-4 py-3 text-base">Don&rsquo;t allow</button>
              </form>
            </div>
          </>
        ) : (
          <>
            <h1 className="font-serif text-2xl italic text-ink">This connection can&rsquo;t go ahead</h1>
            <p role="alert" className="mt-3 rounded-lg bg-urgent-soft px-3.5 py-2.5 text-sm text-urgent">{check.error}</p>
          </>
        )}
      </div>
    </main>
  )
}
