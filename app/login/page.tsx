'use client'
import { useActionState } from 'react'
import { use } from 'react'
import { signIn } from './actions'
import Image from 'next/image'

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = use(searchParams)
  const [error, action, pending] = useActionState(signIn, null)

  return (
    <main className="flex min-h-dvh items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-9">
          {/* The whole mouse, disco ball and all (Brandon, 24 Sept 2026) —
              the first thing anyone sees. The face alone is used everywhere
              else; see app/ui/mouse-face.tsx. */}
          <Image
            src="/mouse/studio-mouse.jpg"
            alt="Studio Mouse, a pink pom-pom mouse holding up a disco ball"
            width={720}
            height={960}
            priority
            className="mb-7 h-auto w-44 rounded-2xl shadow-sm sm:w-52"
          />
          <h1
            className="font-serif text-3xl italic text-ink"
            style={{ letterSpacing: '0.16em' }}
          >
            Studio Mouse
          </h1>
          <p className="mt-3 text-sm tracking-wide text-muted">Cleo Camp Studio Admin</p>
        </div>

        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="next" value={next ?? '/'} />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-sm font-medium">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoFocus
              autoComplete="current-password"
              className="rounded-lg border border-line bg-surface px-3.5 py-3 text-base
                         outline-none focus-visible:border-accent
                         focus-visible:ring-2 focus-visible:ring-accent/25"
            />
          </div>

          {error ? (
            <p role="alert" className="rounded-lg bg-urgent-soft px-3.5 py-2.5 text-sm text-urgent">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-ink px-4 py-3 text-base font-medium text-bg
                       disabled:opacity-60"
          >
            {pending ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </main>
  )
}
