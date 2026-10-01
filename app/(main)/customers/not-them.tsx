'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { setNotThem } from './actions'

export function NotThem({ customerId, dismissed }: { customerId: string; dismissed: boolean }) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  return (
    <span className="inline-flex flex-col">
      <button type="button" disabled={pending} className="self-start rounded-lg border border-line px-3 py-1.5 text-xs disabled:opacity-40"
        onClick={() => start(async () => {
          setError(null)
          const r = await setNotThem(customerId, !dismissed)
          if (!r.ok) setError(r.error); else router.refresh()
        })}>
        {pending ? '…' : dismissed ? 'Undo: it is them' : 'Not them'}
      </button>
      {error ? <span className="text-xs text-urgent">{error}</span> : null}
    </span>
  )
}
