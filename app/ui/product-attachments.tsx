'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { attachComponentToProduct, detachComponentFromProduct } from '@/app/(main)/components/actions'

type Product = { id: string; name: string }
export type Usage = { productId: string; productName: string; qtyPerUnit: string }

/**
 * Which products a component goes into, and how much of it each one takes.
 *
 * Brandon, 11 Sept: "every component belongs to a product or shipping... when
 * adding a component or editing a component we should be able to attach it to
 * a product. read only isn't helpful." So this edits in place rather than
 * describing the state and sending someone to the chat to change it.
 *
 * The quantity has no default and no placeholder value that would be accepted
 * as one. A line means "one of these takes exactly this much" — usually 1 for
 * a label, 0.7 yards for a tee — and guessing it is how a forecast goes quietly
 * wrong. See attachComponentToProduct.
 */
export function ProductAttachments({
  componentId, unit, usage, products,
}: {
  componentId: string
  unit: string
  usage: Usage[]
  products: Product[]
}) {
  const [pending, start] = useTransition()
  const [addingId, setAddingId] = useState('')
  const [addingQty, setAddingQty] = useState('')
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  const unused = products.filter((p) => !usage.some((u) => u.productId === p.id))

  function attach(productId: string, qtyRaw: string, onDone?: () => void) {
    const qty = parseFloat(qtyRaw)
    if (!Number.isFinite(qty) || qty <= 0) {
      setError('How much of it one finished unit takes is needed — that is what the line is.')
      return
    }
    setError(null)
    start(async () => {
      await attachComponentToProduct(componentId, productId, qty)
      onDone?.()
      router.refresh()
    })
  }

  return (
    <div className="mt-3 border-t border-line pt-3">
      <p className="text-xs text-muted">Goes into</p>

      {usage.length ? (
        <ul className="mt-1.5 flex flex-col gap-1.5">
          {usage.map((u) => (
            <UsageRow
              key={u.productId}
              usage={u}
              unit={unit}
              pending={pending}
              onSave={(qty) => attach(u.productId, qty)}
              onRemove={() =>
                start(async () => {
                  await detachComponentFromProduct(componentId, u.productId)
                  router.refresh()
                })
              }
            />
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-xs text-faint">
          Not on any product yet. If this goes into something, add it here — that is what
          lets Studio Mouse work out how many are needed.
        </p>
      )}

      {unused.length ? (
        <div className="mt-2.5 flex flex-wrap items-end gap-2">
          <select
            value={addingId}
            onChange={(e) => setAddingId(e.target.value)}
            className="rounded-lg border border-line bg-bg px-2.5 py-1.5 text-sm"
          >
            <option value="">Add to a product…</option>
            {unused.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {addingId ? (
            <>
              <div className="flex items-center gap-1">
                <input
                  autoFocus
                  value={addingQty}
                  onChange={(e) => setAddingQty(e.target.value)}
                  inputMode="decimal"
                  placeholder="how many"
                  className="w-28 rounded-lg border border-line bg-bg px-2.5 py-1.5 text-sm"
                />
                <span className="text-xs text-faint">{unit} per unit</span>
              </div>
              <button
                type="button"
                disabled={pending}
                onClick={() => attach(addingId, addingQty, () => { setAddingId(''); setAddingQty('') })}
                className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40 dark:text-[#0F1211]"
              >
                {pending ? 'Adding…' : 'Add'}
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {error ? <p className="mt-1.5 text-xs text-warn">{error}</p> : null}
    </div>
  )
}

function UsageRow({
  usage, unit, pending, onSave, onRemove,
}: {
  usage: Usage
  unit: string
  pending: boolean
  onSave: (qty: string) => void
  onRemove: () => void
}) {
  const [qty, setQty] = useState(usage.qtyPerUnit)
  const dirty = qty !== usage.qtyPerUnit

  return (
    <li className="flex flex-wrap items-center gap-2 text-sm">
      <span className="min-w-[10rem]">{usage.productName}</span>
      <input
        value={qty}
        onChange={(e) => setQty(e.target.value)}
        inputMode="decimal"
        className="w-24 rounded-lg border border-line bg-bg px-2.5 py-1 text-sm"
      />
      <span className="text-xs text-faint">{unit} per unit</span>
      {dirty ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => onSave(qty)}
          className="rounded-lg bg-accent px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40 dark:text-[#0F1211]"
        >
          Save
        </button>
      ) : null}
      <button
        type="button"
        disabled={pending}
        onClick={onRemove}
        className="rounded-lg border border-line px-2.5 py-1 text-xs text-muted hover:bg-bg disabled:opacity-40"
      >
        Remove
      </button>
    </li>
  )
}
