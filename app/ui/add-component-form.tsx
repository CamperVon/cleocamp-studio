'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createComponent } from '@/app/(main)/components/actions'
import { VendorPicker } from '@/app/ui/vendor-picker'

type Vendor = { id: string; name: string }
type Product = { id: string; name: string }

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
 * be able to attach it to a product." Naming the product here is what stops a
 * new component landing straight in the unassigned pile for someone to find
 * later. It stays optional — packaging genuinely belongs to no product — but
 * choosing one requires saying how much of it a unit takes, because that is
 * what a bill-of-materials line is and a guessed figure is worse than none.
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
  const [productId, setProductId] = useState('')
  const [qty, setQty] = useState('')

  function reset() {
    setName(''); setCategory('MATERIAL'); setUnit(''); setStocked(false); setStockedTouched(false)
    setVendorId(''); setSku(''); setCost(''); setLead(''); setProductId(''); setQty(''); setError(null)
  }

  function save() {
    if (!name.trim() || !unit.trim()) {
      setError('Name and unit of measure are both needed — everything else can wait.')
      return
    }
    const qtyNum = qty.trim() === '' ? null : parseFloat(qty)
    if (productId && (qtyNum === null || !Number.isFinite(qtyNum) || qtyNum <= 0)) {
      setError('Say how much of it one finished unit takes — that is what putting it on a product means.')
      return
    }
    start(async () => {
      const costCents = cost.trim() === '' ? null : Math.round(parseFloat(cost) * 100)
      const leadDays = lead.trim() === '' ? null : Math.round(parseFloat(lead))
      await createComponent({
        name, category, unitOfMeasure: unit.trim(), stockedInStudio: stocked,
        vendorId: vendorId || null, vendorSku: sku || null,
        unitCostCents: Number.isFinite(costCents) ? costCents : null,
        leadTimeDays: Number.isFinite(leadDays) ? leadDays : null,
        productId: productId || null,
        qtyPerUnit: productId ? qtyNum : null,
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

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted">
          Goes into
          <select
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            className="rounded-lg border border-line bg-bg px-2.5 py-1.5 text-sm"
          >
            <option value="">
              {category === 'PACKAGING' ? 'Nothing — it ships with orders' : 'Choose a product…'}
            </option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        {productId ? (
          <label className="flex flex-col gap-1 text-xs text-muted">
            How many per finished unit
            <div className="flex items-center gap-1">
              <input
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                inputMode="decimal"
                placeholder="e.g. 1"
                className="w-24 rounded-lg border border-line bg-bg px-2.5 py-1.5 text-sm"
              />
              <span className="text-faint">{unit.trim() || 'per unit'}</span>
            </div>
          </label>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-3">
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
        no need to have it all before saving. It can go on more than one product later.
      </p>
    </div>
  )
}
