import { db } from '@/lib/db'
import { poLineLabel } from '@/lib/po'
import { Page, Card, Chip, Empty, Money } from '@/app/ui/primitives'

export const dynamic = 'force-dynamic'

/**
 * Every purchase order, findable regardless of status — the gap that sent
 * Brandon looking for a "Purchase Orders" tab that didn't exist (3 Sept
 * 2026). Home and Finances deliberately only show SENT/PARTIALLY_RECEIVED —
 * this is the one place a DRAFT you made yesterday is still where you left it.
 */
const STATUS: Record<string, { label: string; tone: 'neutral' | 'accent' | 'warn' | 'urgent' }> = {
  DRAFT: { label: 'Draft — not sent', tone: 'warn' },
  SENT: { label: 'Sent', tone: 'accent' },
  PARTIALLY_RECEIVED: { label: 'Partially received', tone: 'accent' },
  RECEIVED: { label: 'Received', tone: 'neutral' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
}

export default async function PurchaseOrders() {
  const pos = await db.purchaseOrder.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      vendor: true, forProduct: true,
      lines: { include: { component: true, productVariant: { include: { product: true, colorway: true } } } },
    },
  })

  const groups: Array<{ key: string; title: string; items: typeof pos }> = [
    { key: 'DRAFT', title: 'Drafts — not sent', items: pos.filter((p) => p.status === 'DRAFT') },
    {
      key: 'OPEN', title: 'Sent, in flight',
      items: pos.filter((p) => p.status === 'SENT' || p.status === 'PARTIALLY_RECEIVED'),
    },
    { key: 'DONE', title: 'Received', items: pos.filter((p) => p.status === 'RECEIVED') },
    { key: 'CANCELLED', title: 'Cancelled', items: pos.filter((p) => p.status === 'CANCELLED') },
  ].filter((g) => g.items.length)

  const row = (p: (typeof pos)[number]) => {
    const total = p.lines.reduce((n, l) => n + Number(l.qtyOrdered) * (l.unitCostCents ?? 0), 0)
    return (
      <li key={p.id} className="px-4 py-3.5 sm:px-5">
        <a href={`/po/${p.poNumber}`} target="_blank" rel="noreferrer" className="block hover:underline">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium">PO {p.poNumber} &middot; {p.vendor.name}</p>
              <Chip tone={STATUS[p.status].tone}>{STATUS[p.status].label}</Chip>
            </div>
            <Money cents={total} />
          </div>
        </a>
        <p className="mt-1 truncate text-sm text-muted">
          {p.lines.map((l) => poLineLabel(l)).join(', ')}
          {p.forProduct ? ` · for the ${p.forProduct.name}` : ''}
        </p>
        <p className="mt-0.5 text-xs text-faint">
          {p.createdAt.toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric' })}
          {p.expectedAt
            ? ` · expected ${p.expectedAt.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' })}`
            : ''}
        </p>
      </li>
    )
  }

  return (
    <Page title="Purchase orders" lede="Every order Studio Mouse has drafted or sent, whatever its status.">
      {pos.length === 0 ? (
        <Card><Empty>No purchase orders yet.</Empty></Card>
      ) : (
        groups.map((g) => (
          <Card key={g.key} title={`${g.title} (${g.items.length})`}>
            <ul className="divide-y divide-line">{g.items.map(row)}</ul>
          </Card>
        ))
      )}
    </Page>
  )
}
