'use client'
import { useActionState } from 'react'
import { use } from 'react'
import { signIn } from './actions'

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
        <div className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight">Studio Mouse</h1>
          <p className="mt-1.5 text-sm text-muted">Cleo Camp studio admin</p>
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
            className="rounded-lg bg-accent px-4 py-3 text-base font-medium text-white
                       disabled:opacity-60 dark:text-[#0F1211]"
          >
            {pending ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </main>
  )
}
