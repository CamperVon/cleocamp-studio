'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createVendorQuick } from '@/app/(main)/components/actions'

type Vendor = { id: string; name: string }

/**
 * A vendor select that can add the vendor it doesn't find.
 *
 * Brandon, 10 Sept: "the drop down list of vendors is good, but we need to
 * be able to add one if not there." Filling in a component's blanks
 * shouldn't dead-end at "the vendor isn't in the list yet, go create it
 * somewhere else and come back."
 *
 * Newly created vendors are merged into THIS picker's options immediately —
 * no waiting on a server round trip to see what you just typed — and
 * router.refresh() re-fetches the page's own vendor list in the background,
 * so every other picker on the page (other component rows) picks it up too
 * without a hard reload or losing their own open/editing state.
 */
export function VendorPicker({
  value, onChange, vendors,
}: { value: string; onChange: (id: string) => void; vendors: Vendor[] }) {
  const [extra, setExtra] = useState<Vendor[]>([])
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [pending, start] = useTransition()
  const router = useRouter()

  const options = [...vendors, ...extra.filter((e) => !vendors.some((v) => v.id === e.id))]

  function create() {
    const trimmed = name.trim()
    if (!trimmed) return
    start(async () => {
      const v = await createVendorQuick(trimmed)
      setExtra((e) => [...e, v])
      onChange(v.id)
      setAdding(false)
      setName('')
      router.refresh()
    })
  }

  if (adding) {
    return (
      <div className="flex items-center gap-1.5">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Vendor name"
          disabled={pending}
          className="w-32 rounded-lg border border-line bg-bg px-2.5 py-1.5 text-sm"
          onKeyDown={(e) => { if (e.key === 'Enter') create() }}
        />
        <button
          type="button"
          disabled={pending || !name.trim()}
          onClick={create}
          className="rounded-lg bg-ink px-2 py-1.5 text-xs font-medium text-bg disabled:opacity-40"
        >
          {pending ? '…' : 'Add'}
        </button>
        <button
          type="button"
          onClick={() => { setAdding(false); setName('') }}
          className="text-xs text-faint underline"
        >
          Cancel
        </button>
      </div>
    )
  }

  return (
    <select
      value={value}
      onChange={(e) => (e.target.value === '__new__' ? setAdding(true) : onChange(e.target.value))}
      className="rounded-lg border border-line bg-bg px-2.5 py-1.5 text-sm"
    >
      <option value="">— none —</option>
      {options.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
      <option value="__new__">+ Add a vendor…</option>
    </select>
  )
}
