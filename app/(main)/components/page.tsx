import { db } from '@/lib/db'
import { Page, Card } from '@/app/ui/primitives'
import { ComponentRow, RetiredComponentRow, type StockDisplay } from '@/app/ui/component-row'
import { AddComponentForm } from '@/app/ui/add-component-form'

export const dynamic = 'force-dynamic'

/**
 * Brandon, 10 Sept: "shouldn't we broaden this to something that is more
 * accurate. we will rarely have button in studio. we will have them at
 * various factories" — followed by "I would remove 'in studio' from all
 * points on the page... except for things we actually ship... obviously
 * shipping supplies are separate." and "we need [real per-location
 * tracking] — otherwise SM won't know how many they need or if there is a
 * surplus. don't worry about small counts for repairs."
 *
 * Four groups now, not two, because "counted here" and "not counted at all"
 * turned out to be hiding a THIRD real state — counted, just not here:
 *
 *  - SHIPPING — packaging, genuinely held and counted at the studio. The one
 *    place "In studio" was always literally true.
 *  - STUDIO STASH — anything else someone actually keeps a small stock of
 *    here (a jar of spare buttons for repairs). Same simple count; Brandon
 *    said not to worry about tracking these precisely.
 *  - AT VENDORS — most trim and hardware now. Bought per production run,
 *    shipped straight to whoever is cutting it, same as fabric always was —
 *    but unlike fabric, THIS is worth counting, because a factory can end
 *    up sitting on a real surplus or running short, and nobody would know.
 *    Shown as a real per-place breakdown (lib/mouse/tools.ts:
 *    ComponentLocationStock), not a single number.
 *  - FABRIC — MATERIAL components, unchanged from before. Never modeled as
 *    stock anywhere, by design (CLAUDE.md §3) — "Incoming" only.
 */
type Row = Awaited<ReturnType<typeof load>>[number]

async function load() {
  return db.component.findMany({
    where: { active: true },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
    include: {
      vendor: { select: { name: true } },
      // How much of this a finished product actually takes — 3 yards of
      // shell fabric per You Dress, two snaps per bag.
      usedIn: {
        where: { parentProductId: { not: null } },
        orderBy: { id: 'asc' },
        include: { parentProduct: { select: { name: true } } },
      },
      // Where it actually is, when that's tracked per place rather than as
      // one studio number.
      locationStock: {
        where: { qty: { not: 0 } },
        orderBy: { updatedAt: 'desc' },
        include: { location: { select: { name: true } }, atVendor: { select: { name: true } } },
      },
    },
  })
}

function bomUsageOf(c: Row) {
  return c.usedIn.map((l) => ({
    productName: l.parentProduct!.name,
    qtyPerUnit: Number(l.qtyPerUnit).toLocaleString(),
    unit: c.unitOfMeasure,
  }))
}

function Table({ rows, stockOf, stockHeader, vendors }: {
  rows: Row[]
  stockOf: (c: Row) => StockDisplay
  stockHeader: string
  vendors: { id: string; name: string }[]
}) {
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
            <th className="px-3 py-2 text-right font-normal sm:pr-5">{stockHeader}</th>
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
              stockedInStudio={c.stockedInStudio}
              unitCostCents={c.unitCostCents}
              unitOfMeasure={c.unitOfMeasure}
              leadTimeDays={c.leadTimeDays}
              stock={stockOf(c)}
              vendors={vendors}
              bomUsage={bomUsageOf(c)}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default async function Components() {
  const [rows, vendors, retired] = await Promise.all([
    load(),
    db.vendor.findMany({ where: { active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    // Retired rather than deleted — anything a product, an order or the ledger
    // still refers to. Listed so "where did it go?" has an answer, and so one
    // taken off by mistake can come back without needing Studio Mouse.
    db.component.findMany({
      where: { active: false },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, notes: true },
    }),
  ])

  const shipping = rows.filter((c) => c.stockedInStudio && c.category === 'PACKAGING')
  const studioStash = rows.filter((c) => c.stockedInStudio && c.category !== 'PACKAGING')
  const atVendors = rows.filter((c) => !c.stockedInStudio && c.category !== 'MATERIAL')
  const fabric = rows.filter((c) => !c.stockedInStudio && c.category === 'MATERIAL')

  return (
    <Page
      title="Components"
      lede="Everything that goes into a product, plus the packaging that goes out with it. Click a row to fill in what's missing."
    >
      <AddComponentForm vendors={vendors} />

      {shipping.length ? (
        <Card title={`Shipping supplies (${shipping.length})`}>
          <p className="border-b border-line bg-sunk px-4 py-2.5 text-xs text-muted sm:px-5">
            Held and counted at the studio — used the moment an order goes out.
          </p>
          <Table
            rows={shipping}
            stockHeader="In studio"
            stockOf={(c) => ({ kind: 'count', value: String(c.onHandQty), unit: c.unitOfMeasure })}
            vendors={vendors}
          />
        </Card>
      ) : null}

      {studioStash.length ? (
        <Card title={`Kept at the studio (${studioStash.length})`}>
          <Table
            rows={studioStash}
            stockHeader="In studio"
            stockOf={(c) => ({ kind: 'count', value: String(c.onHandQty), unit: c.unitOfMeasure })}
            vendors={vendors}
          />
        </Card>
      ) : null}

      {atVendors.length ? (
        <Card title={`At vendors (${atVendors.length})`}>
          <p className="border-b border-line bg-sunk px-4 py-2.5 text-xs text-muted sm:px-5">
            Bought per production run and shipped straight to whoever is cutting it — but
            unlike fabric, this is worth counting, so Studio Mouse can tell a shortage from a
            surplus. Tell Mouse what came in, where, or what a run used to keep this current.
          </p>
          <Table
            rows={atVendors}
            stockHeader="Where it is"
            stockOf={(c) => ({
              kind: 'byPlace',
              unit: c.unitOfMeasure,
              rows: c.locationStock.map((s) => ({
                place: s.atVendor?.name ?? s.location?.name ?? 'unknown',
                qty: Number(s.qty).toLocaleString(),
              })),
            })}
            vendors={vendors}
          />
        </Card>
      ) : null}

      {fabric.length ? (
        <Card title={`Fabric — bought per production run (${fabric.length})`}>
          <p className="border-b border-line bg-sunk px-4 py-2.5 text-xs text-muted sm:px-5">
            Shipped straight from the vendor to the manufacturer. Never stocked or counted,
            by design — what matters is what a planned run will need, and what is already on
            order.
          </p>
          <Table
            rows={fabric}
            stockHeader="Incoming"
            stockOf={(c) => ({ kind: 'count', value: String(c.incomingQty), unit: c.unitOfMeasure })}
            vendors={vendors}
          />
        </Card>
      ) : null}

      {retired.length ? (
        <Card title={`Retired (${retired.length})`}>
          <p className="border-b border-line bg-sunk px-4 py-2.5 text-xs text-muted sm:px-5">
            Taken off the list but kept, because a product, an order or the stock ledger still
            refers to them — deleting one would take that history with it. Anything nothing
            refers to is deleted outright instead and does not appear here. Restore one if it
            came off by mistake.
          </p>
          <ul className="divide-y divide-line">
            {retired.map((c) => (
              <RetiredComponentRow key={c.id} id={c.id} name={c.name} notes={c.notes} />
            ))}
          </ul>
        </Card>
      ) : null}
    </Page>
  )
}
