'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createComponent } from '@/app/(main)/components/actions'
import { VendorPicker } from '@/app/ui/vendor-picker'

type Vendor = { id: string; name: string }
type Product = { id: string; name: string }
type Attachment = { productId: string; qty: string }

const CATEGORIES = [
  { value: 'MATERIAL', label: 'Material — fabric, leather, denim' },
  { value: 'TRIM', label: 'Trim — buttons, tags, zippers' },
  { value: 'HARDWARE', label: 'Hardware — studs, snaps, magnets, rivets' },
  { value: 'PACKAGING', label: 'Packaging — bags, stickers, hang tags' },
  { value: 'SUBASSEMBLY', label: 'Sub-assembly — built from other components' },
]

/**
 * Add a component the list is missing entirely.
 *
 * Brandon, 10 Sept: "we should be able to add other components if they are
 * missing. if SM has questions, he can bring up in corner or todo" — so this
 * is a plain write and does not interrogate anyone up front. Only name,
 * category and unit are required.
 *
 * Brandon, 11 Sept: "when adding a component or editing a component we should
 * be able to attach it to a product", then 12 Sept: "we might need to add to
 * multiple products, don't have that option." One tag goes on eleven things,
 * so the product is a repeatable row, not a single choice. Each row carries
 * its own quantity — a bag and a tee do not necessarily take the same amount
 * of the same thing, and a shared figure would be a guess applied to both.
 */
export function AddComponentForm({ vendors, products }: { vendors: Vendor[]; products: Product[] }) {
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  const [name, setName] = useState('')
  const [category, setCategory] = useState('MATERIAL')
  const [unit, setUnit] = useState('')
  // Only packaging is genuinely, reliably held at the studio now — most
  // trim and hardware ships to whichever vendor is cutting the run, same as
  // fabric always has. This follows the category as a starting point, not a
  // rule; the checkbox stays a real override either way.
  const [stocked, setStocked] = useState(false)
  const [stockedTouched, setStockedTouched] = useState(false)
  const [vendorId, setVendorId] = useState('')
  const [sku, setSku] = useState('')
  const [cost, setCost] = useState('')
  const [lead, setLead] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])

  function reset() {
    setName(''); setCategory('MATERIAL'); setUnit(''); setStocked(false); setStockedTouched(false)
    setVendorId(''); setSku(''); setCost(''); setLead(''); setAttachments([]); setError(null)
  }

  function setAttachment(i: number, patch: Partial<Attachment>) {
    setAttachments((a) => a.map((row, n) => (n === i ? { ...row, ...patch } : row)))
  }

  function save() {
    if (!name.trim() || !unit.trim()) {
      setError('Name and unit of measure are both needed — everything else can wait.')
      return
    }
    // Brandon, 12 Sept: "need to be able to save even if we don't have the
    // yardage etc." A blank quantity is not an error — it stores as 0, which
    // reads as "unknown" everywhere and is counted as a gap to fill later.
    const chosen = attachments.filter((a) => a.productId)
    start(async () => {
      const costCents = cost.trim() === '' ? null : Math.round(parseFloat(cost) * 100)
      const leadDays = lead.trim() === '' ? null : Math.round(parseFloat(lead))
      await createComponent({
        name, category, unitOfMeasure: unit.trim(), stockedInStudio: stocked,
        vendorId: vendorId || null, vendorSku: sku || null,
        unitCostCents: Number.isFinite(costCents) ? costCents : null,
        leadTimeDays: Number.isFinite(leadDays) ? leadDays : null,
        attachments: chosen.map((a) => {
          const n = parseFloat(a.qty)
          return { productId: a.productId, qtyPerUnit: Number.isFinite(n) && n > 0 ? n : null }
        }),
      })
      reset()
      setOpen(false)
      router.refresh()
    })
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start rounded-lg border border-line px-3.5 py-2 text-sm font-medium text-muted hover:bg-sunk"
      >
        + Add a component
      </button>
    )
  }

  const unitLabel = unit.trim() || 'per unit'

  return (
    <div className="rounded-xl border border-line bg-surface p-4 sm:p-5">
      <p className="text-sm font-medium">New component</p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted">
          Name
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Beveled Magnetic Snap, Gold, 19mm"
            className="w-64 rounded-lg border border-line bg-bg px-2.5 py-1.5 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Category
          <select
            value={category}
            onChange={(e) => {
              setCategory(e.target.value)
              // Re-guess the default only until someone has actually
              // touched the checkbox themselves — after that it's theirs.
              if (!stockedTouched) setStocked(e.target.value === 'PACKAGING')
            }}
            className="rounded-lg border border-line bg-bg px-2.5 py-1.5 text-sm"
          >
            {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Unit of measure
          <input
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            placeholder="yard, each, roll…"
            className="w-28 rounded-lg border border-line bg-bg px-2.5 py-1.5 text-sm"
          />
        </label>
        <label className="flex items-center gap-1.5 pb-1.5 text-sm text-muted">
          <input
            type="checkbox"
            checked={stocked}
            onChange={(e) => { setStocked(e.target.checked); setStockedTouched(true) }}
          />
          Counted in the studio
        </label>
      </div>

      <div className="mt-3.5 border-t border-line pt-3">
        <p className="text-xs text-muted">Goes into</p>
        {attachments.length ? (
          <ul className="mt-1.5 flex flex-col gap-2">
            {attachments.map((a, i) => {
              const taken = attachments.filter((_, n) => n !== i).map((x) => x.productId)
              return (
                <li key={i} className="flex flex-wrap items-center gap-2">
                  <select
                    value={a.productId}
                    onChange={(e) => setAttachment(i, { productId: e.target.value })}
                    className="rounded-lg border border-line bg-bg px-2.5 py-1.5 text-sm"
                  >
                    <option value="">Choose a product…</option>
                    {products
                      .filter((p) => p.id === a.productId || !taken.includes(p.id))
                      .map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <input
                    value={a.qty}
                    onChange={(e) => setAttachment(i, { qty: e.target.value })}
                    inputMode="decimal"
                    placeholder="if known"
                    className="w-28 rounded-lg border border-line bg-bg px-2.5 py-1.5 text-sm"
                  />
                  <span className="text-xs text-faint">{unitLabel} per unit</span>
                  <button
                    type="button"
                    onClick={() => setAttachments((rows) => rows.filter((_, n) => n !== i))}
                    className="rounded-lg border border-line px-2.5 py-1 text-xs text-muted hover:bg-bg"
                  >
                    Remove
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="mt-1 text-xs text-faint">
            {category === 'PACKAGING'
              ? 'Packaging usually goes into nothing — it ships with an order. Leave this empty unless it really is part of a garment.'
              : 'Not on a product yet. Add it to as many as it goes into — one tag can be on a dozen things.'}
          </p>
        )}
        {attachments.length < products.length ? (
          <button
            type="button"
            onClick={() => setAttachments((a) => [...a, { productId: '', qty: '' }])}
            className="mt-2 rounded-lg border border-line px-2.5 py-1 text-xs text-muted hover:bg-bg"
          >
            + Add {attachments.length ? 'another product' : 'a product'}
          </button>
        ) : null}
      </div>

      <div className="mt-3.5 flex flex-wrap items-end gap-3 border-t border-line pt-3">
        <label className="flex flex-col gap-1 text-xs text-muted">
          Vendor
          <VendorPicker value={vendorId} onChange={setVendorId} vendors={vendors} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Style #
          <input
            value={sku}
            onChange={(e) => setSku(e.target.value)}
            placeholder="the vendor's own reference"
            className="w-36 rounded-lg border border-line bg-bg px-2.5 py-1.5 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Cost, per unit
          <div className="flex items-center gap-1">
            <span className="text-faint">$</span>
            <input
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              inputMode="decimal"
              placeholder="0.00"
              className="w-24 rounded-lg border border-line bg-bg px-2.5 py-1.5 text-sm"
            />
          </div>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Lead time, days
          <input
            value={lead}
            onChange={(e) => setLead(e.target.value)}
            inputMode="numeric"
            placeholder="0 if in stock"
            className="w-28 rounded-lg border border-line bg-bg px-2.5 py-1.5 text-sm"
          />
        </label>
      </div>

      {error ? <p className="mt-2 text-xs text-warn">{error}</p> : null}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={save}
          className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white disabled:opacity-40 dark:text-[#0F1211]"
        >
          {pending ? 'Saving…' : 'Add component'}
        </button>
        <button
          type="button"
          onClick={() => { reset(); setOpen(false) }}
          className="rounded-lg border border-line px-3.5 py-2 text-sm text-muted hover:bg-sunk"
        >
          Cancel
        </button>
      </div>
      <p className="mt-2 text-xs text-faint">
        Anything left blank just shows as needing details, same as an existing component —
        no need to have it all before saving. More products can be added later.
      </p>
    </div>
  )
}
