import { filesFor } from '@/lib/files'
import { FileLinks } from '@/app/ui/file-links'
import { db } from '@/lib/db'
import { Page, Chip, Value, Fold } from '@/app/ui/primitives'
import { CollapsibleCard } from '@/app/ui/collapsible-card'
import { NewVendor, VendorEditor } from './vendor-controls'

export const dynamic = 'force-dynamic'

const ROLE = {
  MANUFACTURER: 'Manufacturer', DYE_HOUSE: 'Dye house',
  COMPONENT_SUPPLIER: 'Supplier', OTHER: 'Other',
} as const

export default async function Vendors() {
  const [vendors, vendorFiles] = await Promise.all([
    db.vendor.findMany({ orderBy: [{ active: 'desc' }, { role: 'asc' }, { name: 'asc' }] }),
    filesFor('vendor'),
  ])

  const active = vendors.filter((v) => v.active)
  const retired = vendors.filter((v) => !v.active)

  // Each vendor folds closed; what needs attention (no email, so a PO cannot
  // be sent) stays on the closed line.
  const row = (v: (typeof vendors)[number]) => (
    <li key={v.id} data-rec={v.id}>
     <Fold summary={
      <span className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{v.name}</span>
        <Chip tone={v.role === 'MANUFACTURER' ? 'accent' : 'neutral'}>{ROLE[v.role]}</Chip>
        {v.legalName ? <span className="text-xs text-faint">{v.legalName}</span> : null}
        {v.active && !v.email ? <span className="text-xs text-warn">no email</span> : null}
      </span>
     }>
     <div className="px-4 pb-3.5 sm:px-5">
      <FileLinks files={vendorFiles.get(v.id)} className="mt-1" />
      <dl className="mt-1.5 grid grid-cols-1 gap-x-6 gap-y-0.5 text-sm text-muted sm:grid-cols-2">
        {v.contactName || v.contactInfo ? (
          <div className="flex gap-2">
            <dt className="shrink-0 text-faint">Contact</dt>
            <dd>{[v.contactName, v.contactInfo].filter(Boolean).join(' · ')}</dd>
          </div>
        ) : null}
        <div className="flex gap-2">
          <dt className="shrink-0 text-faint">Email</dt>
          {/* Not just a nicety — "send it" reads this field, and only this
              field, so a blank here means a PO to them can't be sent yet. */}
          <dd className={v.email ? undefined : 'text-faint italic'}>
            {v.email ?? 'none on file — send_purchase_order will ask for one'}
          </dd>
        </div>
        {v.ccEmails ? (
          <div className="flex gap-2">
            <dt className="shrink-0 text-faint">Always cc</dt>
            <dd>{v.ccEmails}</dd>
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
      <VendorEditor id={v.id} active={v.active} start={{
        name: v.name, role: v.role, legalName: v.legalName ?? '', contactName: v.contactName ?? '', email: v.email ?? '',
        ccEmails: v.ccEmails ?? '', address: v.address ?? '', orderMethod: v.orderMethod ?? '', paymentTerms: v.paymentTerms ?? '',
        leadTimeDays: v.leadTimeDays == null ? '' : String(v.leadTimeDays), notes: v.notes ?? '',
      }} />
     </div>
     </Fold>
    </li>
  )

  return (
    <Page title="Vendors" lede="Who supplies what, and how you actually place the order.">
      {/* Folds closed like the other lists (Brandon, 1 Oct 2026). */}
      <CollapsibleCard title={`Active (${active.length})`}>
        <Fold summary={<span className="text-sm font-medium">+ Add a vendor</span>}>
          <div className="px-4 pb-4 sm:px-5"><NewVendor /></div>
        </Fold>
        <ul className="divide-y divide-line border-t border-line">{active.map(row)}</ul>
      </CollapsibleCard>
      {retired.length ? (
        <CollapsibleCard title={`Removed or replaced (${retired.length})`}>
          <p className="border-b border-line bg-sunk px-4 py-2.5 text-xs text-muted sm:px-5">
            Kept with their history intact. None of their prices or lead times carry
            forward to whoever replaced them.
          </p>
          <ul className="divide-y divide-line">{retired.map(row)}</ul>
        </CollapsibleCard>
      ) : null}
    </Page>
  )
}
