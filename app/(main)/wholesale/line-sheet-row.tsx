'use client'
import { useState, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { editLineSheetRow, markPriceOneOff, removeLineSheetRow, restoreLineSheetRow, type RowEdit } from './actions'

const input = 'w-full min-w-0 rounded-lg border border-line bg-bg px-3 py-2 text-sm'
const small = 'rounded-lg border border-line px-3 py-1.5 text-xs disabled:opacity-40'

export type SheetRow = {
  id: string
  linked: boolean
  item: string
  colorLabel: string
  description: string
  /** Shopify's description, printing because the row has none of its own. */
  fromShopify: string
  sizing: string
  minOrder: string
  commission: string | null
  availability: string
  /** The row's own, only for a row with no product. Dollars. */
  wholesale: string
  msrp: string | null
}

function useSave() {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const go = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, after?: () => void) => start(async () => {
    setError(null)
    const r = await fn()
    if (!r.ok) return setError(r.error)
    after?.()
    router.refresh()
  })
  return { pending, error, go }
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted">
      {label}
      {children}
    </label>
  )
}

/**
 * One line of the line sheet on the Wholesale page. Tap it to change its
 * words, or to take it off the sheet. Prices on a row with a product are
 * not editable here: they come from the price list and Shopify.
 */
export function LineSheetRowEditor({ row, children }: { row: SheetRow; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [f, setF] = useState(row)
  const { pending, error, go } = useSave()
  const set = (k: keyof SheetRow) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })

  const save = () => {
    const edit: RowEdit = {
      item: f.item, colorLabel: f.colorLabel, description: f.description, sizing: f.sizing,
      minOrder: f.minOrder, commission: f.commission ?? '', availability: f.availability,
      ...(row.linked ? {} : { wholesale: f.wholesale, msrp: f.msrp ?? '' }),
    }
    go(() => editLineSheetRow(row.id, edit), () => setOpen(false))
  }

  return (
    <li>
      <button type="button" onClick={() => { setF(row); setOpen(!open) }}
        className={`w-full px-4 py-2 text-left hover:bg-sunk sm:px-5 ${open ? 'bg-sunk' : ''}`}>
        {children}
      </button>
      {open ? (
        <div className="flex flex-col gap-2.5 border-t border-line bg-sunk px-4 pb-4 pt-3 sm:px-5">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Item"><input value={f.item} onChange={set('item')} className={input} /></Field>
            <Field label="Colour / variant"><input value={f.colorLabel} onChange={set('colorLabel')} className={input} /></Field>
          </div>
          <Field label={row.linked ? 'Description (leave blank to use Shopify’s)' : 'Description'}>
            <textarea value={f.description} onChange={set('description')} rows={3} className={input}
              placeholder={row.fromShopify ? `From Shopify: ${row.fromShopify}` : ''} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Sizing"><input value={f.sizing} onChange={set('sizing')} className={input} /></Field>
            <Field label="Min. order"><input value={f.minOrder} onChange={set('minOrder')} className={input} /></Field>
            <Field label="Commission"><input value={f.commission ?? ''} onChange={set('commission')} placeholder="70/30" className={input} /></Field>
            <Field label="Availability"><input value={f.availability} onChange={set('availability')} placeholder="In Stock" className={input} /></Field>
          </div>
          {row.linked ? (
            <p className="text-[11px] text-faint">
              Wholesale comes from the price list and suggested retail from Shopify. To change a price, tell Mouse.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Field label="Wholesale ($)"><input value={f.wholesale} onChange={set('wholesale')} inputMode="decimal" className={input} /></Field>
              <Field label="Suggested retail"><input value={f.msrp ?? ''} onChange={set('msrp')} placeholder="$148" className={input} /></Field>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={pending} onClick={save} className="rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-bg disabled:opacity-40">
              {pending ? 'Saving…' : 'Save'}
            </button>
            <button type="button" disabled={pending} onClick={() => setOpen(false)} className={small}>Cancel</button>
            <button type="button" disabled={pending} onClick={() => go(() => removeLineSheetRow(row.id))}
              className={`${small} ml-auto text-urgent`}>
              Remove from sheet
            </button>
          </div>
          {error ? <p className="text-xs font-medium text-urgent">{error}</p> : null}
        </div>
      ) : null}
    </li>
  )
}

/** A removed row, with the way back. */
export function RestoreRow({ rowId, label }: { rowId: string; label: string }) {
  const { pending, error, go } = useSave()
  return (
    <li className="flex items-baseline justify-between gap-3 px-4 py-1.5 text-xs text-muted sm:px-5">
      <span className="min-w-0">{label}</span>
      <span className="flex shrink-0 flex-col items-end">
        <button type="button" disabled={pending} onClick={() => go(() => restoreLineSheetRow(rowId))} className="text-accent underline disabled:opacity-40">
          {pending ? '…' : 'Put back'}
        </button>
        {error ? <span className="text-urgent">{error}</span> : null}
      </span>
    </li>
  )
}

/** "One-off": the invoice's price was a deal, the list stays. */
export function OneOffButton(props: { priceKey: string; product: string; charged: string; account: string; invoice: string | null; list: string }) {
  const { pending, error, go } = useSave()
  return (
    <span className="inline-flex flex-col items-end">
      <button type="button" disabled={pending} className="rounded-lg border border-line px-2.5 py-1 text-xs disabled:opacity-40"
        onClick={() => go(() => markPriceOneOff({ key: props.priceKey, product: props.product, charged: props.charged, account: props.account, invoice: props.invoice, list: props.list }))}>
        {pending ? '…' : 'One-off deal'}
      </button>
      {error ? <span className="text-xs text-urgent">{error}</span> : null}
    </span>
  )
}
