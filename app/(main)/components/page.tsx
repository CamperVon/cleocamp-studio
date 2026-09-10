import { db } from '@/lib/db'
import { Page, Card } from '@/app/ui/primitives'
import { ComponentRow } from '@/app/ui/component-row'
import { AddComponentForm } from '@/app/ui/add-component-form'

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
    include: {
      vendor: { select: { name: true } },
      // How much of this a finished product actually takes — 3 yards of
      // shell fabric per You Dress, two snaps per bag. Brandon, 10 Sept:
      // "amt of yardage / item for finished product where applicable" — a
      // sub-assembly's own BOM (parentComponentId) isn't a finished product,
      // so only lines with a real parentProduct count here.
      usedIn: {
        where: { parentProductId: { not: null } },
        orderBy: { id: 'asc' },
        include: { parentProduct: { select: { name: true } } },
      },
    },
  })
}

function Table({ rows, showStock, vendors }: { rows: Row[]; showStock: boolean; vendors: { id: string; name: string }[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[52rem] text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs text-faint">
            <th className="px-4 py-2 font-normal sm:px-5">Component</th>
            <th className="px-3 py-2 font-normal">Vendor</th>
            <th className="px-3 py-2 font-normal">Style #</th>
            <th className="px-3 py-2 text-right font-normal">Cost</th>
            <th className="px-3 py-2 text-right font-normal">Per finished unit</th>
            <th className="px-3 py-2 text-right font-normal">Lead time</th>
            <th className="px-3 py-2 text-right font-normal sm:pr-5">
              {showStock ? 'In studio' : 'Incoming'}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((c) => (
            <ComponentRow
              key={c.id}
              id={c.id}
              name={c.name}
              vendorId={c.vendorId}
              vendorSku={c.vendorSku}
              unitCostCents={c.unitCostCents}
              unitOfMeasure={c.unitOfMeasure}
              leadTimeDays={c.leadTimeDays}
              // Fabric has no stock level by design — showing 0 would read as
              // "we have none", which is a different and wrong claim.
              stockValue={String(showStock ? c.onHandQty : c.incomingQty)}
              showStock={showStock}
              vendors={vendors}
              bomUsage={c.usedIn.map((l) => ({
                productName: l.parentProduct!.name,
                qtyPerUnit: Number(l.qtyPerUnit).toLocaleString(),
                unit: c.unitOfMeasure,
              }))}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default async function Components() {
  const [rows, vendors] = await Promise.all([
    load(),
    db.vendor.findMany({ where: { active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
  ])
  const studio = rows.filter((c) => c.stockedInStudio)
  const perRun = rows.filter((c) => !c.stockedInStudio)

  const byCategory = studio.reduce<Record<string, Row[]>>((acc, r) => {
    (acc[r.category] ??= []).push(r)
    return acc
  }, {})

  return (
    <Page
      title="Components"
      lede="Everything that goes into a product, plus the packaging that goes out with it. Click a row to fill in what's missing."
    >
      <AddComponentForm vendors={vendors} />

      {perRun.length ? (
        <Card title="Bought per production run">
          <p className="border-b border-line bg-sunk px-4 py-2.5 text-xs text-muted sm:px-5">
            Shipped straight from the vendor to the manufacturer. These never reach the
            studio and are never counted — what matters is what a planned run will need,
            and what is already on order.
          </p>
          <Table rows={perRun} showStock={false} vendors={vendors} />
        </Card>
      ) : null}

      {Object.entries(byCategory).map(([category, items]) => (
        <Card key={category} title={`${LABELS[category] ?? category} — in the studio`}>
          <Table rows={items} showStock vendors={vendors} />
        </Card>
      ))}
    </Page>
  )
}
