'use client'
import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { detachComponentFromProduct } from '@/app/(main)/components/actions'

type Product = { id: string; name: string }
/** qtyPerUnit null means nobody has said how much yet — never shown as 0. */
export type Usage = { productId: string; productName: string; qtyPerUnit: string | null }
export type PendingRow = { productId: string; qty: string }

/**
 * Which products a component goes into, and how much of it each one takes.
 *
 * Brandon, 12 Sept: "i keep saving my edits and they are still not attached to
 * products." He was right and it was my fault. This form used to have its own
 * save button next to the row's main Save, and the main one called
 * setOpen(false) — which unmounted this component and threw away every queued
 * product without a word. Two save buttons in one form, and the obvious one
 * silently discarded half the work.
 *
 * So this no longer owns any unsaved state or any save button. The row above
 * holds the queued rows and the edited quantities, and its single Save writes
 * the lot. Removing a product is still immediate, because that is an explicit
 * destructive click rather than something typed and forgotten.
 *
 * The quantity stays optional ("need to be able to save even if we don't have
 * the yardage"). Blank stores as 0 — this codebase's "not known yet": shown as
 * unknown, counted as a gap, and skipped by the forecaster rather than treated
 * as zero demand.
 */
export function ProductAttachments({
  componentId, unit, usage, products, rows, onRowsChange, qtyEdits, onQtyEditsChange,
}: {
  componentId: string
  unit: string
  usage: Usage[]
  products: Product[]
  rows: PendingRow[]
  onRowsChange: (rows: PendingRow[]) => void
  qtyEdits: Record<string, string>
  onQtyEditsChange: (edits: Record<string, string>) => void
}) {
  const [pending, start] = useTransition()
  const router = useRouter()

  const attachedIds = usage.map((u) => u.productId)
  const available = products.filter((p) => !attachedIds.includes(p.id))
  const queued = rows.filter((r) => r.productId).length

  return (
    <div className="mt-3 border-t border-line pt-3">
      <p className="text-xs text-muted">Goes into</p>

      {usage.length ? (
        <ul className="mt-1.5 flex flex-col gap-1.5">
          {usage.map((u) => {
            const value = qtyEdits[u.productId] ?? u.qtyPerUnit ?? ''
            return (
              <li key={u.productId} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="min-w-[10rem]">{u.productName}</span>
                <input
                  value={value}
                  onChange={(e) => onQtyEditsChange({ ...qtyEdits, [u.productId]: e.target.value })}
                  inputMode="decimal"
                  placeholder="unknown"
                  className="w-24 rounded-lg border border-line bg-bg px-2.5 py-1 text-sm"
                />
                <span className="text-xs text-faint">{unit} per unit</span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      await detachComponentFromProduct(componentId, u.productId)
                      router.refresh()
                    })
                  }
                  className="rounded-lg border border-line px-2.5 py-1 text-xs text-muted hover:bg-bg disabled:opacity-40"
                >
                  Remove
                </button>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="mt-1 text-xs text-faint">
          Not on any product yet. If this goes into something, add it here — that is what
          lets Studio Mouse work out how many are needed.
        </p>
      )}

      {rows.length ? (
        <ul className="mt-2 flex flex-col gap-2">
          {rows.map((r, i) => {
            const takenHere = rows.filter((_, n) => n !== i).map((x) => x.productId)
            return (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <select
                  value={r.productId}
                  onChange={(e) =>
                    onRowsChange(rows.map((row, n) => (n === i ? { ...row, productId: e.target.value } : row)))
                  }
                  className="rounded-lg border border-line bg-bg px-2.5 py-1.5 text-sm"
                >
                  <option value="">Choose a product…</option>
                  {available
                    .filter((p) => p.id === r.productId || !takenHere.includes(p.id))
                    .map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <input
                  value={r.qty}
                  onChange={(e) =>
                    onRowsChange(rows.map((row, n) => (n === i ? { ...row, qty: e.target.value } : row)))
                  }
                  inputMode="decimal"
                  placeholder="if known"
                  className="w-28 rounded-lg border border-line bg-bg px-2.5 py-1.5 text-sm"
                />
                <span className="text-xs text-faint">{unit} per unit</span>
                <button
                  type="button"
                  onClick={() => onRowsChange(rows.filter((_, n) => n !== i))}
                  className="rounded-lg border border-line px-2.5 py-1 text-xs text-muted hover:bg-bg"
                >
                  Remove
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}

      {rows.length < available.length ? (
        <button
          type="button"
          onClick={() => onRowsChange([...rows, { productId: '', qty: '' }])}
          className="mt-2 rounded-lg border border-line px-2.5 py-1 text-xs text-muted hover:bg-bg"
        >
          + Add {rows.length ? 'another product' : 'to a product'}
        </button>
      ) : null}

      <p className="mt-1.5 text-xs text-faint">
        {queued
          ? `${queued} product${queued > 1 ? 's' : ''} ready — press Save above to write ${queued > 1 ? 'them' : 'it'}.`
          : 'Add as many products as it goes into, then press Save above. The quantity can wait — blank shows as unknown.'}
      </p>
    </div>
  )
}
