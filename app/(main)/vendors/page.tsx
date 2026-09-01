import { db } from '@/lib/db'
import { Page, Card, Chip, Value } from '@/app/ui/primitives'

export const dynamic = 'force-dynamic'

const ROLE = {
  MANUFACTURER: 'Manufacturer', DYE_HOUSE: 'Dye house',
  COMPONENT_SUPPLIER: 'Supplier', OTHER: 'Other',
} as const

export default async function Vendors() {
  const vendors = await db.vendor.findMany({
    orderBy: [{ active: 'desc' }, { role: 'asc' }, { name: 'asc' }],
  })

  const active = vendors.filter((v) => v.active)
  const retired = vendors.filter((v) => !v.active)

  const row = (v: (typeof vendors)[number]) => (
    <li key={v.id} className="px-4 py-3.5 sm:px-5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium">{v.name}</p>
        <Chip tone={v.role === 'MANUFACTURER' ? 'accent' : 'neutral'}>{ROLE[v.role]}</Chip>
        {v.legalName ? <span className="text-xs text-faint">{v.legalName}</span> : null}
      </div>
      <dl className="mt-1.5 grid grid-cols-1 gap-x-6 gap-y-0.5 text-sm text-muted sm:grid-cols-2">
        {v.contactName || v.contactInfo ? (
          <div className="flex gap-2">
            <dt className="shrink-0 text-faint">Contact</dt>
            <dd>{[v.contactName, v.contactInfo].filter(Boolean).join(' · ')}</dd>
          </div>
        ) : null}
        {v.address ? (
          <div className="flex gap-2">
            <dt className="shrink-0 text-faint">Address</dt>
            <dd>{v.address}</dd>
          </div>
        ) : null}
        <div className="flex gap-2">
          <dt className="shrink-0 text-faint">Order by</dt>
          <dd><Value value={v.orderMethod} /></dd>
        </div>
        <div className="flex gap-2">
          <dt className="shrink-0 text-faint">Terms</dt>
          <dd><Value value={v.paymentTerms} /></dd>
        </div>
      </dl>
      {v.notes ? <p className="mt-1.5 text-sm text-muted">{v.notes}</p> : null}
    </li>
  )

  return (
    <Page title="Vendors" lede="Who supplies what, and how you actually place the order.">
      <Card title={`Active (${active.length})`}>
        <ul className="divide-y divide-line">{active.map(row)}</ul>
      </Card>
      {retired.length ? (
        <Card title={`Replaced (${retired.length})`}>
          <p className="border-b border-line bg-sunk px-4 py-2.5 text-xs text-muted sm:px-5">
            Kept with their history intact. None of their prices or lead times carry
            forward to whoever replaced them.
          </p>
          <ul className="divide-y divide-line">{retired.map(row)}</ul>
        </Card>
      ) : null}
    </Page>
  )
}
