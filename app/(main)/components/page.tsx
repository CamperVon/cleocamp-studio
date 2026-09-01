import { db } from '@/lib/db'
import { Page, Card, Value, Money } from '@/app/ui/primitives'

export const dynamic = 'force-dynamic'

const LABELS: Record<string, string> = {
  MATERIAL: 'Materials', TRIM: 'Trim', HARDWARE: 'Hardware',
  PACKAGING: 'Packaging', SUBASSEMBLY: 'Sub-assemblies',
}

type Row = Awaited<ReturnType<typeof load>>[number]

async function load() {
  return db.component.findMany({
    where: { active: true },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
    include: { vendor: { select: { name: true } } },
  })
}

function Table({ rows, showStock }: { rows: Row[]; showStock: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[42rem] text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs text-faint">
            <th className="px-4 py-2 font-normal sm:px-5">Component</th>
            <th className="px-3 py-2 font-normal">Vendor</th>
            <th className="px-3 py-2 font-normal">Style #</th>
            <th className="px-3 py-2 text-right font-normal">Cost</th>
            <th className="px-3 py-2 text-right font-normal">Lead time</th>
            <th className="px-3 py-2 text-right font-normal sm:pr-5">
              {showStock ? 'In studio' : 'Incoming'}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((c) => (
            <tr key={c.id}>
              <td className="px-4 py-2.5 sm:px-5">{c.name}</td>
              <td className="px-3 py-2.5 text-muted"><Value value={c.vendor?.name} /></td>
              <td className="px-3 py-2.5 font-mono text-xs text-muted"><Value value={c.vendorSku} /></td>
              <td className="px-3 py-2.5 text-right">
                <Money cents={c.unitCostCents} />
                {c.unitCostCents !== null ? <span className="text-faint">/{c.unitOfMeasure}</span> : null}
              </td>
              <td className="px-3 py-2.5 text-right">
                {c.leadTimeDays === 0
                  ? <span className="text-accent">in stock</span>
                  : <Value value={c.leadTimeDays} unit="days" />}
              </td>
              <td className="px-3 py-2.5 text-right sm:pr-5">
                {/* Fabric has no stock level by design. Showing 0 would read as
                    "we have none", which is a different and wrong claim. */}
                <span className="tnum">{String(showStock ? c.onHandQty : c.incomingQty)}</span>
                <span className="text-faint"> {c.unitOfMeasure}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default async function Components() {
  const rows = await load()
  const studio = rows.filter((c) => c.stockedInStudio)
  const perRun = rows.filter((c) => !c.stockedInStudio)

  const byCategory = studio.reduce<Record<string, Row[]>>((acc, r) => {
    (acc[r.category] ??= []).push(r)
    return acc
  }, {})

  return (
    <Page
      title="Components"
      lede="Everything that goes into a product, plus the packaging that goes out with it."
    >
      {perRun.length ? (
        <Card title="Bought per production run">
          <p className="border-b border-line bg-sunk px-4 py-2.5 text-xs text-muted sm:px-5">
            Shipped straight from the vendor to the manufacturer. These never reach the
            studio and are never counted — what matters is what a planned run will need,
            and what is already on order.
          </p>
          <Table rows={perRun} showStock={false} />
        </Card>
      ) : null}

      {Object.entries(byCategory).map(([category, items]) => (
        <Card key={category} title={`${LABELS[category] ?? category} — in the studio`}>
          <Table rows={items} showStock />
        </Card>
      ))}
    </Page>
  )
}
