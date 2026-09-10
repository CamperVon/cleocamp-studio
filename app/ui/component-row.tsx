'use client'
import { useState, useTransition } from 'react'
import { updateComponentDetails } from '@/app/(main)/components/actions'
import { VendorPicker } from '@/app/ui/vendor-picker'
import { Chip } from './primitives'

type Vendor = { id: string; name: string }
type BomUsage = { productName: string; qtyPerUnit: string; unit: string }
export type StockDisplay =
  // A single number in one place — the studio, for shipping supplies and a
  // real stash kept there, or fabric's "Incoming" (never a stock claim).
  | { kind: 'count'; value: string; unit: string }
  // Held across more than one possible place — most trim and hardware now.
  // Brandon, 10 Sept: "SM exists for clear accounting" — a scalar cannot say
  // whether 350 buttons means comfortable or means 300 of them are stuck at
  // a vendor nobody's chasing.
  | { kind: 'byPlace'; rows: Array<{ place: string; qty: string }>; unit: string }

const money = (c: number | null) => (c === null ? '' : (c / 100).toFixed(2))

/**
 * One component row, click to fill in what's missing.
 *
 * Brandon, 10 Sept: "if you can make the items clickable (drop down form) I
 * can have someone fill in the blanks easier." A plain write on submit, not a
 * round trip through Studio Mouse — vendor, style number, cost and lead time
 * are facts someone reads off an invoice and types in, with no judgement call
 * for Mouse to make. See app/(main)/components/actions.ts for why that
 * boundary is drawn there and not here.
 */
export function ComponentRow({
  id, name, vendorId, vendorSku, unitCostCents, unitOfMeasure, leadTimeDays,
  stock, vendors, bomUsage,
}: {
  id: string
  name: string
  vendorId: string | null
  vendorSku: string | null
  unitCostCents: number | null
  unitOfMeasure: string
  leadTimeDays: number | null
  stock: StockDisplay
  vendors: Vendor[]
  bomUsage: BomUsage[]
}) {
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  const [saved, setSaved] = useState(false)

  const [fVendorId, setFVendorId] = useState(vendorId ?? '')
  const [fSku, setFSku] = useState(vendorSku ?? '')
  const [fCost, setFCost] = useState(money(unitCostCents))
  const [fLead, setFLead] = useState(leadTimeDays === null ? '' : String(leadTimeDays))

  // A gap someone can point at from across the room — the whole reason this
  // exists is to make blanks easy to find, not just easy to fill once found.
  const missing = !vendorId || !vendorSku || unitCostCents === null || leadTimeDays === null

  function save() {
    start(async () => {
      const cost = fCost.trim() === '' ? null : Math.round(parseFloat(fCost) * 100)
      const lead = fLead.trim() === '' ? null : Math.round(parseFloat(fLead))
      await updateComponentDetails(id, {
        vendorId: fVendorId || null,
        vendorSku: fSku,
        unitCostCents: Number.isFinite(cost) ? cost : null,
        leadTimeDays: Number.isFinite(lead) ? lead : null,
      })
      setSaved(true)
      setOpen(false)
      setTimeout(() => setSaved(false), 2500)
    })
  }

  const vendorName = vendors.find((v) => v.id === vendorId)?.name

  return (
    <>
      <tr
        onClick={() => setOpen((o) => !o)}
        className="cursor-pointer hover:bg-sunk"
        aria-expanded={open}
      >
        <td className="px-4 py-2.5 sm:px-5">
          <span className="mr-1.5 inline-block w-3 text-faint">{open ? '▾' : '▸'}</span>
          {name}
          {missing ? <span className="ml-1.5"><Chip tone="warn">needs details</Chip></span> : null}
          {saved ? <span className="ml-1.5 text-xs text-accent">saved</span> : null}
        </td>
        <td className="px-3 py-2.5 text-muted">{vendorName ?? '—'}</td>
        <td className="px-3 py-2.5 font-mono text-xs text-muted">{vendorSku || '—'}</td>
        <td className="px-3 py-2.5 text-right">
          {unitCostCents !== null ? (
            <>
              <span className="tnum">${money(unitCostCents)}</span>
              <span className="text-faint">/{unitOfMeasure}</span>
            </>
          ) : '—'}
        </td>
        <td className="px-3 py-2.5 text-right">
          {bomUsage.length === 0 ? (
            <span className="text-faint">—</span>
          ) : (
            <span className="tnum">
              {bomUsage.map((u, i) => (
                <span key={i} className="block whitespace-nowrap">
                  {u.qtyPerUnit} {u.unit} <span className="text-faint">/ {u.productName}</span>
                </span>
              ))}
            </span>
          )}
        </td>
        <td className="px-3 py-2.5 text-right">
          {leadTimeDays === 0
            ? <span className="text-accent">in stock</span>
            : leadTimeDays === null ? '—' : <span className="tnum">{leadTimeDays} days</span>}
        </td>
        <td className="px-3 py-2.5 text-right sm:pr-5">
          {stock.kind === 'count' ? (
            <>
              <span className="tnum">{stock.value}</span>
              <span className="text-faint"> {stock.unit}</span>
            </>
          ) : stock.rows.length === 0 ? (
            <span className="text-faint">not recorded yet</span>
          ) : (
            <span className="tnum">
              {stock.rows.map((r, i) => (
                <span key={i} className="block whitespace-nowrap">
                  {r.qty} {stock.unit} <span className="text-faint">· {r.place}</span>
                </span>
              ))}
            </span>
          )}
        </td>
      </tr>
      {open ? (
        <tr>
          <td colSpan={7} className="bg-sunk px-4 py-3.5 sm:px-5">
            <div
              className="flex flex-wrap items-end gap-3"
              onClick={(e) => e.stopPropagation()}
            >
              <label className="flex flex-col gap-1 text-xs text-muted">
                Vendor
                <VendorPicker value={fVendorId} onChange={setFVendorId} vendors={vendors} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted">
                Style #
                <input
                  value={fSku}
                  onChange={(e) => setFSku(e.target.value)}
                  placeholder="the vendor's own reference"
                  className="w-36 rounded-lg border border-line bg-bg px-2.5 py-1.5 text-sm"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted">
                Cost, per {unitOfMeasure}
                <div className="flex items-center gap-1">
                  <span className="text-faint">$</span>
                  <input
                    value={fCost}
                    onChange={(e) => setFCost(e.target.value)}
                    inputMode="decimal"
                    placeholder="0.00"
                    className="w-24 rounded-lg border border-line bg-bg px-2.5 py-1.5 text-sm"
                  />
                </div>
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted">
                Lead time, days
                <input
                  value={fLead}
                  onChange={(e) => setFLead(e.target.value)}
                  inputMode="numeric"
                  placeholder="0 if in stock"
                  className="w-28 rounded-lg border border-line bg-bg px-2.5 py-1.5 text-sm"
                />
              </label>
              <button
                type="button"
                disabled={pending}
                onClick={save}
                className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40 dark:text-[#0F1211]"
              >
                {pending ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg border border-line px-3 py-1.5 text-sm text-muted hover:bg-bg"
              >
                Cancel
              </button>
            </div>
            <p className="mt-2 text-xs text-faint">
              Stock counts and incoming quantities aren&rsquo;t edited here — tell Studio
              Mouse what came in or what was counted, so the ledger stays right.
            </p>
          </td>
        </tr>
      ) : null}
    </>
  )
}
