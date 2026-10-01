import { db } from '@/lib/db'
import { Page, Card, Fold, Empty } from '@/app/ui/primitives'
import { CollapsibleCard } from '@/app/ui/collapsible-card'
import { BIG_SPENDER_CENTS, REPEAT_ORDERS } from '@/lib/customers'
import { NotThem } from './not-them'
import { AddCustomer, CustomerNotes } from './customer-controls'

export const dynamic = 'force-dynamic'

/**
 * Customers worth knowing about: notable people, repeat buyers and big
 * buyers, kept by the nightly pass from Shopify (lib/customers.ts). Brandon,
 * 30 Sept 2026. Yesterday's orders from any of them also make the Daily
 * Cheese. Wholesale stores and our own addresses are left out.
 */
const day = (d: Date | null) => (d ? d.toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', year: 'numeric' }) : '—')
const dollars = (cents: number) => `$${Math.round(cents / 100).toLocaleString('en-US')}`

type Row = Awaited<ReturnType<typeof load>>[number]
async function load(where: object, orderBy: object[]) {
  return db.customer.findMany({ where: { excluded: false, ...where }, orderBy, take: 200 })
}

function CustomerRow({ c }: { c: Row }) {
  return (
    <li>
      <Fold summary={
        <span className="flex items-baseline justify-between gap-3">
          <span className="min-w-0">
            <span className="font-medium">{c.name}</span>
            {c.city ? <span className="text-xs text-muted"> · {c.city}</span> : null}
            {c.notes ? <span className="block truncate text-xs text-muted">{c.notes.split('\n')[0]}</span> : null}
            {c.notable && !c.notableDismissedAt ? <span className="block text-xs text-accent">{c.notable === 'likely' ? '' : 'Possibly '}{c.notableWho}</span> : null}
          </span>
          <span className="shrink-0 text-right text-xs text-muted">{c.orderCount} order{c.orderCount === 1 ? '' : 's'} · {dollars(c.totalSpentCents)}</span>
        </span>
      }>
        <div className="flex flex-col gap-1.5 px-4 pb-3.5 text-xs text-muted sm:px-5">
          <p className="flex flex-wrap gap-x-3 gap-y-0.5">
            {c.email ? <a href={`mailto:${c.email}`} className="text-accent underline">{c.email}</a> : <span>No email on file</span>}
            {c.shopifyCustomerId
              ? <a href={`https://admin.shopify.com/store/cleocamp/customers/${c.shopifyCustomerId}`} target="_blank" rel="noreferrer" className="text-accent underline">Open in Shopify</a>
              : <span>Not on Shopify yet</span>}
          </p>
          {c.lastOrderAt ? <p>Last order {c.lastOrderName ?? ''} on {day(c.lastOrderAt)} · customer since {day(c.firstSeenAt)}</p> : null}
          <CustomerNotes id={c.id} notes={c.notes} pinned={!!c.pinnedAt} />
          {c.notable ? (
            <div className="flex flex-col gap-1.5 rounded-lg border border-line bg-sunk px-3 py-2">
              <p>
                <span className="font-medium text-ink">{c.notable === 'likely' ? 'Looks to be' : 'Possibly'}: </span>{c.notableWho}
                {c.notableSource ? <> · <a href={c.notableSource} target="_blank" rel="noreferrer" className="text-accent underline">source</a></> : null}
              </p>
              <p className="text-[11px] text-faint">
                {c.notable === 'likely' ? 'Something ties this buyer to that person (city, work email, or a very rare name).' : 'A public figure with this name exists; nothing shows it is this buyer.'} Checked {day(c.notableCheckedAt)}.
              </p>
              <NotThem customerId={c.id} dismissed={!!c.notableDismissedAt} />
            </div>
          ) : null}
        </div>
      </Fold>
    </li>
  )
}

export default async function Customers() {
  const [mine, notable, repeat, big, totals] = await Promise.all([
    db.customer.findMany({ where: { pinnedAt: { not: null } }, take: 500 }).then((r) => r.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }))),
    load({ notable: { not: null }, notableDismissedAt: null }, [{ notable: 'asc' }, { totalSpentCents: 'desc' }]),
    load({ orderCount: { gte: REPEAT_ORDERS } }, [{ orderCount: 'desc' }, { totalSpentCents: 'desc' }]),
    load({ totalSpentCents: { gte: BIG_SPENDER_CENTS } }, [{ totalSpentCents: 'desc' }]),
    Promise.all([
      db.customer.count({ where: { excluded: false } }),
      db.customer.count({ where: { excluded: false, notableCheckedAt: { not: null } } }),
    ]),
  ])
  const [all, checked] = totals
  const likely = notable.filter((c) => c.notable === 'likely').length
  const list = (rows: Row[], empty: string) => rows.length
    ? <ul className="divide-y divide-line">{rows.map((c) => <CustomerRow key={c.id} c={c} />)}</ul>
    : <Empty>{empty}</Empty>

  return (
    <Page title="Customers" lede="Customers you add, and notable people, repeat buyers and big buyers from Shopify. Each has notes. Yesterday's orders from any of them also go in the Daily Cheese.">
      {all === 0 ? (
        <Card><Empty>Fills in after the nightly run (5am).</Empty></Card>
      ) : null}
      {/* Added by hand or by Mouse (Brandon, 1 Oct 2026), A to Z. */}
      <CollapsibleCard title={`Added by hand (${mine.length})`}>
        {list(mine, 'Nobody added yet. Add someone below, or tell Mouse.')}
        <div className="border-t border-line">
          <Fold summary={<span className="text-sm font-medium text-accent">+ Add a customer</span>}>
            <AddCustomer />
          </Fold>
        </div>
      </CollapsibleCard>
      <CollapsibleCard title={<span>Notable ({notable.length}){likely ? <span className="text-xs text-muted"> · {likely} likely</span> : null}</span>}>
        <p className="border-b border-line bg-sunk px-4 py-2.5 text-xs text-muted sm:px-5">
          A quick web search on each customer&rsquo;s name, a few a night, yesterday&rsquo;s buyers first. A name is not proof:
          &ldquo;likely&rdquo; means something ties them together, &ldquo;possibly&rdquo; means only the name matches. Tap Not them on a wrong one.
          {all ? ` ${checked.toLocaleString('en-US')} of ${all.toLocaleString('en-US')} checked so far.` : ''}
        </p>
        {list(notable, 'Nobody notable found yet.')}
      </CollapsibleCard>
      <CollapsibleCard title={`Repeat buyers, ${REPEAT_ORDERS}+ orders (${repeat.length})`}>
        {list(repeat, 'None yet.')}
      </CollapsibleCard>
      <CollapsibleCard title={`Big buyers, ${dollars(BIG_SPENDER_CENTS)}+ (${big.length})`}>
        {list(big, 'None yet.')}
      </CollapsibleCard>
    </Page>
  )
}
