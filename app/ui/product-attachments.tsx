'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { attachComponentToProduct, detachComponentFromProduct } from '@/app/(main)/components/actions'

type Product = { id: string; name: string }
/** qtyPerUnit null means nobody has said how much yet — never shown as 0. */
export type Usage = { productId: string; productName: string; qtyPerUnit: string | null }
type Pending = { productId: string; qty: string }

/**
 * Which products a component goes into, and how much of it each one takes.
 *
 * Brandon, 11 Sept: "every component belongs to a product or shipping... when
 * adding a component or editing a component we should be able to attach it to
 * a product. read only isn't helpful."
 *
 * Brandon, 12 Sept: "how do i add a second product when editing a component."
 * One at a time was technically possible and practically not, because of where
 * it was being done from: a component opened in "Not on a product yet" stops
 * being unassigned the moment the first product is saved, so the row unmounts
 * and the half-finished form goes with it. Queuing several and saving them
 * together fixes that properly — the row only leaves once the work is done —
 * and matches how the add-component form already behaves.
 *
 * The quantity stays optional throughout ("need to be able to save even if we
 * don't have the yardage"). Blank stores as 0, which is this codebase's "not
 * known yet": shown as unknown, counted as a gap on the Products page, and
 * skipped by the forecaster rather than treated as zero demand.
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
  const [rows, setRows] = useState<Pending[]>([])
  const router = useRouter()

  const attachedIds = usage.map((u) => u.productId)
  const available = products.filter((p) => !attachedIds.includes(p.id))

  function setRow(i: number, patch: Partial<Pending>) {
    setRows((r) => r.map((row, n) => (n === i ? { ...row, ...patch } : row)))
  }

  const chosen = rows.filter((r) => r.productId)

  function saveAll() {
    if (!chosen.length) return
    start(async () => {
      // Sequential on purpose: each one is a separate row and a failure part
      // way through should leave the earlier ones written, not roll them back.
      for (const r of chosen) {
        const n = parseFloat(r.qty)
        await attachComponentToProduct(componentId, r.productId, Number.isFinite(n) && n > 0 ? n : null)
      }
      setRows([])
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
              onSave={(qty) => {
                const n = parseFloat(qty)
                start(async () => {
                  await attachComponentToProduct(
                    componentId, u.productId, Number.isFinite(n) && n > 0 ? n : null,
                  )
                  router.refresh()
                })
              }}
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

      {rows.length ? (
        <ul className="mt-2 flex flex-col gap-2">
          {rows.map((r, i) => {
            const takenHere = rows.filter((_, n) => n !== i).map((x) => x.productId)
            return (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <select
                  value={r.productId}
                  onChange={(e) => setRow(i, { productId: e.target.value })}
                  className="rounded-lg border border-line bg-bg px-2.5 py-1.5 text-sm"
                >
                  <option value="">Choose a product…</option>
                  {available
                    .filter((p) => p.id === r.productId || !takenHere.includes(p.id))
                    .map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <input
                  value={r.qty}
                  onChange={(e) => setRow(i, { qty: e.target.value })}
                  inputMode="decimal"
                  placeholder="if known"
                  className="w-28 rounded-lg border border-line bg-bg px-2.5 py-1.5 text-sm"
                />
                <span className="text-xs text-faint">{unit} per unit</span>
                <button
                  type="button"
                  onClick={() => setRows((rs) => rs.filter((_, n) => n !== i))}
                  className="rounded-lg border border-line px-2.5 py-1 text-xs text-muted hover:bg-bg"
                >
                  Remove
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {rows.length < available.length ? (
          <button
            type="button"
            onClick={() => setRows((r) => [...r, { productId: '', qty: '' }])}
            className="rounded-lg border border-line px-2.5 py-1 text-xs text-muted hover:bg-bg"
          >
            + Add {rows.length ? 'another product' : 'to a product'}
          </button>
        ) : null}
        {chosen.length ? (
          <button
            type="button"
            disabled={pending}
            onClick={saveAll}
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40 dark:text-[#0F1211]"
          >
            {pending
              ? 'Adding…'
              : `Add to ${chosen.length} product${chosen.length > 1 ? 's' : ''}`}
          </button>
        ) : null}
      </div>

      <p className="mt-1.5 text-xs text-faint">
        Add as many products as it goes into before saving. The quantity can wait — leave it
        blank and it shows as unknown until someone knows it.
      </p>
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
  const original = usage.qtyPerUnit ?? ''
  const [qty, setQty] = useState(original)
  const dirty = qty !== original

  return (
    <li className="flex flex-wrap items-center gap-2 text-sm">
      <span className="min-w-[10rem]">{usage.productName}</span>
      <input
        value={qty}
        onChange={(e) => setQty(e.target.value)}
        inputMode="decimal"
        placeholder="unknown"
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
