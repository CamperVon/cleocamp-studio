import { db } from '@/lib/db'
import { Page, Card, Chip, Value, Money } from '@/app/ui/primitives'

export const dynamic = 'force-dynamic'

const STATUS_TONE = {
  ACTIVE: 'accent', SAMPLING: 'warn', DEVELOPMENT: 'neutral', SUNSETTED: 'neutral',
} as const

export default async function Products() {
  const products = await db.product.findMany({
    orderBy: [{ status: 'asc' }, { name: 'asc' }],
    include: {
      colorways: { orderBy: { customerName: 'asc' } },
      variants: { select: { id: true } },
      bomLines: { include: { component: { select: { name: true, unitOfMeasure: true } } } },
    },
  })

  return (
    <Page title="Products" lede="What Cleo Camp makes, and what goes into each one.">
      {products.map((p) => (
        <Card
          key={p.id}
          title={p.name}
          action={<Chip tone={STATUS_TONE[p.status]}>{p.status.toLowerCase()}</Chip>}
        >
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-b border-line px-4 py-3 text-sm sm:grid-cols-4 sm:px-5">
            <div>
              <dt className="text-xs text-faint">Retail</dt>
              <dd><Money cents={p.retailPriceCents} /></dd>
            </div>
            <div>
              <dt className="text-xs text-faint">Production lead time</dt>
              <dd><Value value={p.productionLeadTimeDays} unit="days" /></dd>
            </div>
            <div>
              <dt className="text-xs text-faint">Colourways</dt>
              <dd className="tnum">{p.colorways.filter((c) => c.active).length}</dd>
            </div>
            <div>
              <dt className="text-xs text-faint">Variants</dt>
              <dd className="tnum">{p.variants.length}</dd>
            </div>
          </dl>

          {p.colorways.length ? (
            <div className="border-b border-line px-4 py-3 sm:px-5">
              <p className="mb-2 text-xs text-faint">
                Colourways — what customers see, and what the dye house calls it
              </p>
              <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
                {p.colorways.map((c) => (
                  <li key={c.id} className="text-sm">
                    <span className={c.active ? '' : 'text-faint line-through'}>{c.customerName}</span>
                    {c.dyeHouseName ? (
                      <span className="text-faint"> · {c.dyeHouseName}</span>
                    ) : c.inHouseMatch ? (
                      <span className="text-warn"> · in-house match</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {p.bomLines.length ? (
            <div className="px-4 py-3 sm:px-5">
              <p className="mb-2 text-xs text-faint">Per unit</p>
              <ul className="flex flex-col gap-1">
                {p.bomLines.map((b) => (
                  <li key={b.id} className="flex justify-between gap-3 text-sm">
                    <span>{b.component.name}</span>
                    <span className="tnum text-muted">
                      {String(b.qtyPerUnit)} {b.component.unitOfMeasure}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="px-4 py-3 text-sm text-faint sm:px-5">
              No bill of materials yet — Studio Mouse will ask.
            </p>
          )}
        </Card>
      ))}
    </Page>
  )
}
