import { db } from '@/lib/db'
import { Page, Card } from '@/app/ui/primitives'
import { CollapsibleCard } from '@/app/ui/collapsible-card'
import { ComponentRow, RetiredComponentRow, type StockDisplay } from '@/app/ui/component-row'
import { ProductSection } from '@/app/ui/product-section'
import { AddComponentForm } from '@/app/ui/add-component-form'

export const dynamic = 'force-dynamic'

/**
 * Brandon, 11 Sept: "every component belongs to a product or shipping. (if
 * it's blank right now, it's perhaps because that data has yet to be input or
 * organized?) ... don't hide products. we know we have to fill them."
 *
 * That is the rule this page is built around, and it corrected a real mistake
 * in how it was described here before: components with no product were being
 * treated as a KIND of component rather than as data nobody had entered. They
 * are a to-do list, and 32 of 46 were sitting in it.
 *
 * So the page reads top to bottom as the work:
 *
 *  - BY PRODUCT — every product, collapsed, including the ones with nothing
 *    recorded yet. An empty one is a job, not a product without parts, and
 *    hiding it would hide the job.
 *  - NOT ON A PRODUCT YET — anything that is not packaging and not on a bill
 *    of materials. Open by default: it is the pile to work through, and it
 *    should trend to empty.
 *  - ALL COMPONENTS — the cross-product view, "since some cover multiple
 *    products": Main label alone is on eleven. Kept in the four stock groups
 *    built on 10 Sept, because where a thing is counted is a different
 *    question from what it goes into and both still matter:
 *      · SHIPPING — packaging, genuinely held and counted at the studio, and
 *        the one group that legitimately belongs to no product.
 *      · STUDIO STASH — a small stock kept here (spare buttons for repairs).
 *      · AT VENDORS — most trim and hardware: bought per run and shipped to
 *        whoever is cutting it, but worth counting, because a factory can sit
 *        on a surplus and nobody would know.
 *      · FABRIC — never modeled as stock anywhere, by design (CLAUDE.md §3).
 *
 * Those four fold away (Brandon, 12 Sept: "At vendor should be a drop down") —
 * At vendors alone is 24 rows, and four open tables rebuilt the long scroll
 * this page was reorganised to get rid of.
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
    productId: l.parentProductId!,
    productName: l.parentProduct!.name,
    // 0 is this codebase's "not known yet" for a BOM quantity — null here so
    // the UI shows "unknown" rather than a confident zero. Same convention the
    // Products page and lib/forecast.ts already use.
    qtyPerUnit: Number(l.qtyPerUnit) === 0 ? null : Number(l.qtyPerUnit).toLocaleString(),
    unit: c.unitOfMeasure,
  }))
}

const countStock = (c: Row): StockDisplay =>
  ({ kind: 'count', value: String(c.onHandQty), unit: c.unitOfMeasure })

const placeStock = (c: Row): StockDisplay => ({
  kind: 'byPlace',
  unit: c.unitOfMeasure,
  rows: c.locationStock.map((s) => ({
    place: s.atVendor?.name ?? s.location?.name ?? 'unknown',
    qty: Number(s.qty).toLocaleString(),
  })),
})

function Table({ rows, stockOf, stockHeader, vendors, products, inProductId }: {
  rows: Row[]
  stockOf: (c: Row) => StockDisplay
  stockHeader: string
  vendors: { id: string; name: string }[]
  products: { id: string; name: string }[]
  inProductId?: string
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
              products={products}
              inProductId={inProductId}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default async function Components() {
  const [rows, vendors, products, retired] = await Promise.all([
    load(),
    db.vendor.findMany({ where: { active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    // Sunsetted products are out. Brandon's "don't hide products, we know we
    // have to fill them" was about products with nothing recorded YET — those
    // still show, flagged, because they are work to do. A sunsetted one is the
    // opposite: finished with, kept only so old purchase orders still read
    // correctly. Listing it here put "Cleo Bag" in the worklist beside the five
    // per-colour products that replaced it — the same bag twice, which is
    // exactly what he objected to.
    db.product.findMany({
      where: { status: { not: 'SUNSETTED' } },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
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

  // Packaging is the one thing that genuinely belongs to no product — it goes
  // out with an order, not into a garment. Everything else without a bill-of-
  // materials line is simply not entered yet.
  const unassigned = rows.filter((c) => c.category !== 'PACKAGING' && c.usedIn.length === 0)

  const byProduct = products.map((p) => ({
    ...p,
    components: rows.filter((c) => c.usedIn.some((l) => l.parentProductId === p.id)),
  }))

  const tableProps = { vendors, products }

  return (
    <Page
      title="Components"
      lede="Everything that goes into a product, plus the packaging that goes out with it. Open a row to fill in what's missing, rename it, or say which products it belongs to."
    >
      <AddComponentForm vendors={vendors} products={products} />

      <Card title={`By product (${byProduct.length})`}>
        <p className="border-b border-line bg-sunk px-4 py-2.5 text-xs text-muted sm:px-5">
          Every product, including the ones with nothing recorded yet — those are data still
          to enter, not products without parts. Open a component to change how much of it a
          unit takes, or to put it on another product.
        </p>
        <div className="divide-y divide-line">
          {byProduct.map((p) => (
            <ProductSection key={p.id} name={p.name} count={p.components.length}>
              {p.components.length ? (
                <Table
                  {...tableProps}
                  rows={p.components}
                  inProductId={p.id}
                  stockHeader="Where it is"
                  stockOf={(c) => (c.stockedInStudio ? countStock(c) : placeStock(c))}
                />
              ) : (
                <p className="px-4 py-3 text-xs text-faint sm:px-5">
                  Nothing recorded yet. Open any component below and add it to {p.name}, or
                  add a new one with the button at the top of the page.
                </p>
              )}
            </ProductSection>
          ))}
        </div>
      </Card>

      {unassigned.length ? (
        <CollapsibleCard title={`Not on a product yet (${unassigned.length})`} defaultOpen>
          <p className="border-b border-line bg-sunk px-4 py-2.5 text-xs text-muted sm:px-5">
            These aren&rsquo;t shipping supplies, so each one goes into something — it just
            hasn&rsquo;t been said which yet. Open a row and add it to a product. Until then
            Studio Mouse can&rsquo;t work out how many are needed for a run, because nothing
            connects them to what gets made.
          </p>
          <Table
            {...tableProps}
            rows={unassigned}
            stockHeader="Where it is"
            stockOf={(c) => (c.stockedInStudio ? countStock(c) : placeStock(c))}
          />
        </CollapsibleCard>
      ) : null}

      <h2 className="mt-2 px-1 text-sm font-medium text-muted">
        All components
        <span className="ml-2 text-xs font-normal text-faint">
          every one, once — several are on more than one product
        </span>
      </h2>

      {shipping.length ? (
        <CollapsibleCard title={`Shipping supplies (${shipping.length})`}>
          <p className="border-b border-line bg-sunk px-4 py-2.5 text-xs text-muted sm:px-5">
            Held and counted at the studio — used the moment an order goes out. The one group
            that belongs to no product, because it goes out with an order rather than into a
            garment.
          </p>
          <Table {...tableProps} rows={shipping} stockHeader="In studio" stockOf={countStock} />
        </CollapsibleCard>
      ) : null}

      {studioStash.length ? (
        <CollapsibleCard title={`Kept at the studio (${studioStash.length})`}>
          <Table {...tableProps} rows={studioStash} stockHeader="In studio" stockOf={countStock} />
        </CollapsibleCard>
      ) : null}

      {atVendors.length ? (
        <CollapsibleCard title={`At vendors (${atVendors.length})`}>
          <p className="border-b border-line bg-sunk px-4 py-2.5 text-xs text-muted sm:px-5">
            Bought per production run and shipped straight to whoever is cutting it — but
            unlike fabric, this is worth counting, so Studio Mouse can tell a shortage from a
            surplus. Tell Mouse what came in, where, or what a run used to keep this current.
          </p>
          <Table {...tableProps} rows={atVendors} stockHeader="Where it is" stockOf={placeStock} />
        </CollapsibleCard>
      ) : null}

      {fabric.length ? (
        <CollapsibleCard title={`Fabric — bought per production run (${fabric.length})`}>
          <p className="border-b border-line bg-sunk px-4 py-2.5 text-xs text-muted sm:px-5">
            Shipped straight from the vendor to the manufacturer. Never stocked or counted,
            by design — what matters is what a planned run will need, and what is already on
            order.
          </p>
          <Table
            {...tableProps}
            rows={fabric}
            stockHeader="Incoming"
            stockOf={(c) => ({ kind: 'count', value: String(c.incomingQty), unit: c.unitOfMeasure })}
          />
        </CollapsibleCard>
      ) : null}

      {retired.length ? (
        <CollapsibleCard title={`Retired (${retired.length})`}>
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
        </CollapsibleCard>
      ) : null}
    </Page>
  )
}
