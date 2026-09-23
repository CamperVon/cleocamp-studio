'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  attachComponentToProduct, removeComponent, restoreComponent, updateComponentDetails,
} from '@/app/(main)/components/actions'
import { VendorPicker } from '@/app/ui/vendor-picker'
import { ProductAttachments, type PendingRow } from '@/app/ui/product-attachments'
import { Chip } from './primitives'

type Vendor = { id: string; name: string }
type Product = { id: string; name: string }
/** qtyPerUnit null means nobody has said how much yet — never shown as 0. */
type BomUsage = { productId: string; productName: string; qtyPerUnit: string | null; unit: string }
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
 * One component that was taken off the page but kept.
 *
 * Anything a product, an order or the ledger still refers to can only be
 * retired, never deleted — see removeComponent in
 * app/(main)/components/actions.ts. Listing them here is what makes that
 * honest rather than a disappearance: "where did it go" has an answer, and a
 * row removed by mistake comes back without needing Studio Mouse.
 */
export function RetiredComponentRow({
  id, name, notes,
}: { id: string; name: string; notes: string | null }) {
  const [pending, start] = useTransition()
  const router = useRouter()
  return (
    <li className="flex items-start justify-between gap-4 px-4 py-2.5 sm:px-5">
      <div className="min-w-0">
        <div className="text-sm">{name}</div>
        {notes ? <div className="mt-0.5 text-xs text-faint">{notes}</div> : null}
      </div>
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => { await restoreComponent(id); router.refresh() })}
        className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-sm text-muted hover:bg-bg disabled:opacity-40"
      >
        {pending ? 'Restoring…' : 'Restore'}
      </button>
    </li>
  )
}

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
  stockedInStudio, stock, vendors, bomUsage, products, inProductId,
}: {
  id: string
  name: string
  vendorId: string | null
  vendorSku: string | null
  unitCostCents: number | null
  unitOfMeasure: string
  leadTimeDays: number | null
  stockedInStudio: boolean
  stock: StockDisplay
  vendors: Vendor[]
  bomUsage: BomUsage[]
  products: Product[]
  /** Set when this row is shown inside one product's section — then the
   *  per-unit column is that product's figure alone, not a list of every
   *  product the component appears on. */
  inProductId?: string
}) {
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  const [saved, setSaved] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const router = useRouter()

  // Queued product attachments and edited per-unit quantities live HERE, not
  // inside ProductAttachments, so the one Save below writes them. They used to
  // live in that component, which this row unmounted on save — silently
  // throwing the work away. Brandon, 12 Sept: "i keep saving my edits and they
  // are still not attached to products."
  const [pendingRows, setPendingRows] = useState<PendingRow[]>([])
  const [qtyEdits, setQtyEdits] = useState<Record<string, string>>({})
  const [fName, setFName] = useState(name)
  const [fVendorId, setFVendorId] = useState(vendorId ?? '')
  const [fSku, setFSku] = useState(vendorSku ?? '')
  const [fCost, setFCost] = useState(money(unitCostCents))
  const [fLead, setFLead] = useState(leadTimeDays === null ? '' : String(leadTimeDays))
  const [fStocked, setFStocked] = useState(stockedInStudio)

  // A gap someone can point at from across the room — the whole reason this
  // exists is to make blanks easy to find, not just easy to fill once found.
  const missing = !vendorId || !vendorSku || unitCostCents === null || leadTimeDays === null

  function save() {
    start(async () => {
      const cost = fCost.trim() === '' ? null : Math.round(parseFloat(fCost) * 100)
      const lead = fLead.trim() === '' ? null : Math.round(parseFloat(fLead))
      await updateComponentDetails(id, {
        name: fName,
        vendorId: fVendorId || null,
        vendorSku: fSku,
        unitCostCents: Number.isFinite(cost) ? cost : null,
        leadTimeDays: Number.isFinite(lead) ? lead : null,
        stockedInStudio: fStocked,
      })

      // One Save, everything it shows. A blank quantity is fine and stores as
      // 0 ("not known yet"); what is never acceptable is dropping a product
      // somebody chose, which is exactly what this form used to do.
      const qty = (raw: string) => {
        const n = parseFloat(raw)
        return Number.isFinite(n) && n > 0 ? n : null
      }
      for (const [productId, raw] of Object.entries(qtyEdits)) {
        await attachComponentToProduct(id, productId, qty(raw))
      }
      for (const r of pendingRows.filter((r) => r.productId)) {
        await attachComponentToProduct(id, r.productId, qty(r.qty))
      }
      setPendingRows([])
      setQtyEdits({})

      setSaved(true)
      // Deliberately NOT closing the row. Closing is what destroyed the queued
      // products before, and leaving it open lets someone see the attachment
      // actually landed rather than taking the word for it.
      setTimeout(() => setSaved(false), 2500)
      // stockedInStudio decides which section on the page this row belongs
      // to — a plain client-state update wouldn't move it there.
      router.refresh()
    })
  }

  const vendorName = vendors.find((v) => v.id === vendorId)?.name
  const inProductQty = inProductId
    ? bomUsage.find((u) => u.productId === inProductId)?.qtyPerUnit ?? null
    : null

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
          {/* Inside a product's own section the product name is the heading
              above, so repeating it on every line is noise. Everywhere else
              the list IS the point — Main label is on eleven products. */}
          {inProductId ? (
            inProductQty === null ? (
              <span className="italic text-faint">unknown</span>
            ) : (
              <span className="tnum whitespace-nowrap">
                {inProductQty} <span className="text-faint">{unitOfMeasure}</span>
              </span>
            )
          ) : bomUsage.length === 0 ? (
            <span className="text-faint">—</span>
          ) : (
            <span className="tnum">
              {bomUsage.map((u, i) => (
                <span key={i} className="block whitespace-nowrap">
                  {u.qtyPerUnit === null
                    ? <span className="italic text-faint">unknown</span>
                    : `${u.qtyPerUnit} ${u.unit}`}{' '}
                  <span className="text-faint">/ {u.productName}</span>
                </span>
              ))}
            </span>
          )}
        </td>
        <td className="px-3 py-2.5 text-right">
          {leadTimeDays === null ? (
            '—'
          ) : (
            <>
              <span className="tnum">{leadTimeDays} days</span>
              {/* Brandon: "we want to see the lead time, even if something
                  is in stock. otherwise we won't know" — 0 used to REPLACE
                  the number with just the word "in stock", which threw away
                  the one fact worth keeping once whatever's on hand runs
                  out. Now it's a note beside the number, never instead of it. */}
              {leadTimeDays === 0 ? <span className="ml-1 text-accent">· in stock</span> : null}
            </>
          )}
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
                Name
                <input
                  value={fName}
                  onChange={(e) => setFName(e.target.value)}
                  className="w-56 rounded-lg border border-line bg-bg px-2.5 py-1.5 text-sm"
                />
              </label>
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
              <label className="flex items-center gap-1.5 pb-1.5 text-sm text-muted">
                <input type="checkbox" checked={fStocked} onChange={(e) => setFStocked(e.target.checked)} />
                Kept at the studio
              </label>
              <button
                type="button"
                disabled={pending}
                onClick={save}
                className="rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-bg disabled:opacity-40"
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

              {/* Brandon, 11 Sept: "we need to be able to delete components in
                  the components page." What that means depends on whether
                  anything refers to it — so say which one is about to happen
                  BEFORE the click, rather than reporting it afterwards to a
                  row that has already vanished. bomUsage is the common case
                  and is already here; the server re-checks orders and ledger
                  entries too and has the final say. */}
              <div className="ml-auto flex items-center gap-2">
                {confirming ? (
                  <>
                    <span className="text-xs text-muted">
                      {bomUsage.length
                        ? `Used on ${bomUsage.length} product${bomUsage.length > 1 ? 's' : ''} — it will be kept under Retired, not deleted.`
                        : 'Nothing uses this. It will be deleted for good.'}
                    </span>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        start(async () => {
                          await removeComponent(id)
                          router.refresh()
                        })
                      }
                      className="rounded-lg bg-[#B3261E] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
                    >
                      {pending ? 'Removing…' : bomUsage.length ? 'Retire it' : 'Delete it'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirming(false)}
                      className="rounded-lg border border-line px-3 py-1.5 text-sm text-muted hover:bg-bg"
                    >
                      Keep
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirming(true)}
                    className="rounded-lg border border-line px-3 py-1.5 text-sm text-[#B3261E] hover:bg-bg"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
            <ProductAttachments
              componentId={id}
              unit={unitOfMeasure}
              usage={bomUsage.map((u) => ({
                productId: u.productId, productName: u.productName, qtyPerUnit: u.qtyPerUnit,
              }))}
              products={products}
              rows={pendingRows}
              onRowsChange={setPendingRows}
              qtyEdits={qtyEdits}
              onQtyEditsChange={setQtyEdits}
            />

            <p className="mt-2 text-xs text-faint">
              These are the component&rsquo;s own details and are shared everywhere it is
              used. Stock counts and incoming quantities aren&rsquo;t edited here — tell
              Studio Mouse what came in or what was counted, so the ledger stays right.
              {fStocked ? '' : ' Where it actually is, once known, is set the same way.'}
            </p>
          </td>
        </tr>
      ) : null}
    </>
  )
}
