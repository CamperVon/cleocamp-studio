import { db } from '@/lib/db'
import { poLineLabel } from '@/lib/po'
import { Page, Card, Chip, Value, Money } from '@/app/ui/primitives'
import { laDay, laMidnight } from '@/lib/dates'

export const dynamic = 'force-dynamic'

const STATUS_TONE = {
  ACTIVE: 'accent', SAMPLING: 'warn', DEVELOPMENT: 'neutral', SUNSETTED: 'neutral',
} as const

export default async function Products() {
  const [products, pos, runs, sales] = await Promise.all([
    db.product.findMany({
      include: {
        colorways: { orderBy: { customerName: 'asc' } },
        variants: { include: { colorway: true } },
        bomLines: { include: { component: { include: { vendor: true } } } },
      },
    }),
    db.purchaseOrder.findMany({
      where: { status: { in: ['DRAFT', 'SENT', 'PARTIALLY_RECEIVED'] } },
      include: { vendor: true, lines: { include: { component: true, productVariant: { include: { product: true, colorway: true } } } } },
    }),
    db.productionRun.findMany({
      where: { status: { notIn: ['RECEIVED', 'CANCELLED'] } },
      include: { vendor: true },
    }),
    db.salesSnapshot.groupBy({
      by: ['productVariantId'],
      _sum: { unitsSold: true },
      where: { date: { gte: laMidnight(56) } },
    }),
  ])

  const sold = new Map(sales.map((s) => [s.productVariantId, s._sum.unitsSold ?? 0]))

  const rows = products.map((p) => {
    const componentIds = new Set(p.bomLines.map((b) => b.componentId))
    // A purchase order belongs to a product when it carries a component that
    // product is made of, or — for a cut-and-sew order — a variant of the
    // product itself. That is what makes both the fabric orders and the
    // production orders show up under the Cleo Tee rather than sitting off
    // on their own.
    const relatedPos = pos
      .map((po) => ({
        po,
        lines: po.lines.filter((l) =>
          (l.componentId && componentIds.has(l.componentId)) || l.productVariant?.productId === p.id),
      }))
      .filter((x) => x.lines.length)
    const relatedRuns = runs.filter((r) => r.productId === p.id)

    const soldTotal = p.variants.reduce((n, v) => n + (sold.get(v.id) ?? 0), 0)
    const onHand = p.variants.reduce(
      (n, v) => (v.onHandQty === null ? n : n + Number(v.onHandQty)), 0)
    const oversold = p.variants.filter((v) => v.onHandQty !== null && Number(v.onHandQty) < 0)
    const weeks = soldTotal > 0 ? onHand / (soldTotal / 8) : null

    // Flags are computed, not written by a model. Studio Mouse comments in
    // chat; these need to be true every time, not most of the time.
    const flags: Array<{ tone: 'urgent' | 'warn'; text: string }> = []
    if (oversold.length) {
      flags.push({
        tone: 'urgent',
        text: `${oversold.length} variant${oversold.length > 1 ? 's' : ''} oversold: ${oversold
          .map((v) => [v.colorway?.customerName, v.size].filter(Boolean).join(' ') + ` (${v.onHandQty})`)
          .join(', ')}`,
      })
    }
    if (weeks !== null && weeks < 4 && !oversold.length) {
      flags.push({ tone: 'urgent', text: `About ${weeks.toFixed(1)} weeks of cover left at the current rate.` })
    }
    if (p.status !== 'SUNSETTED' && p.productionLeadTimeDays === null) {
      flags.push({ tone: 'warn', text: 'No production lead time, so no restock date can be worked out.' })
    }
    if (p.status !== 'SUNSETTED' && p.bomLines.some((b) => Number(b.qtyPerUnit) === 0)) {
      flags.push({ tone: 'warn', text: 'A bill-of-materials quantity is still unknown.' })
    }

    const activity = Math.max(
      ...relatedPos.map((x) => x.po.orderedAt?.getTime() ?? x.po.createdAt.getTime()),
      ...relatedRuns.map((r) => r.startedAt?.getTime() ?? r.createdAt.getTime()),
      soldTotal > 0 ? Date.now() - 1e10 : 0,
      p.createdAt.getTime() - 1e12,
    )

    return { p, relatedPos, relatedRuns, soldTotal, onHand, weeks, flags, activity }
  })

  // Most recent activity first. Both fabric POs went out the same minute, so
  // ties break on what is actually selling — the hero product leads.
  rows.sort((a, b) => b.activity - a.activity || b.soldTotal - a.soldTotal)

  return (
    <Page title="Products" lede="Most recently active first — what is on order, in production, and what Studio Mouse would flag.">
      {rows.map(({ p, relatedPos, relatedRuns, soldTotal, onHand, weeks, flags }) => (
        <Card key={p.id} title={p.name} action={<Chip tone={STATUS_TONE[p.status]}>{p.status.toLowerCase()}</Chip>}>
          {flags.length ? (
            <ul className="divide-y divide-line border-b border-line">
              {flags.map((f, i) => (
                <li key={i} className={`flex items-start gap-2.5 px-4 py-2.5 sm:px-5 ${f.tone === 'urgent' ? 'bg-urgent-soft' : 'bg-warn-soft'}`}>
                  <Chip tone={f.tone}>{f.tone === 'urgent' ? '!' : '?'}</Chip>
                  <p className={`text-sm ${f.tone === 'urgent' ? 'text-urgent' : 'text-warn'}`}>{f.text}</p>
                </li>
              ))}
            </ul>
          ) : null}

          {relatedPos.length || relatedRuns.length ? (
            <div className="border-b border-line px-4 py-3 sm:px-5">
              <p className="mb-2 text-xs text-faint">Updates</p>
              <ul className="flex flex-col gap-1.5">
                {relatedRuns.map((r) => (
                  <li key={r.id} className="flex justify-between gap-3 text-sm">
                    <span>
                      In production at {r.vendor?.name ?? 'unassigned'} · {r.status.toLowerCase().replace(/_/g, ' ')}
                    </span>
                    <span className="shrink-0 text-muted">
                      {r.expectedReadyAt ? laDay(r.expectedReadyAt) : 'no date'}
                    </span>
                  </li>
                ))}
                {relatedPos.map(({ po, lines }) => (
                  <li key={po.id} className="flex justify-between gap-3 text-sm">
                    <span>
                      PO {po.poNumber} · {lines.map((l) => `${l.qtyOrdered} ${l.unit} ${poLineLabel(l)}`).join(', ')} from {po.vendor.name}
                    </span>
                    <span className="shrink-0 text-muted">
                      {po.expectedAt ? laDay(po.expectedAt) : 'ETA unconfirmed'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-b border-line px-4 py-3 text-sm sm:grid-cols-5 sm:px-5">
            <div><dt className="text-xs text-faint">Retail</dt><dd><Money cents={p.retailPriceCents} /></dd></div>
            <div><dt className="text-xs text-faint">On hand</dt><dd className="tnum">{onHand}</dd></div>
            <div><dt className="text-xs text-faint">Sold 8wk</dt><dd className="tnum">{soldTotal}</dd></div>
            <div>
              <dt className="text-xs text-faint">Cover</dt>
              <dd>{weeks === null ? <span className="text-faint italic">no sales</span> : <span className="tnum">{weeks.toFixed(1)} wks</span>}</dd>
            </div>
            <div>
              <dt className="text-xs text-faint">Lead time</dt>
              <dd><Value value={p.productionLeadTimeDays} unit="days" /></dd>
            </div>
          </dl>

          {p.colorways.length ? (
            <div className="border-b border-line px-4 py-3 sm:px-5">
              <p className="mb-2 text-xs text-faint">Colourways — customer name · dye house name</p>
              <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
                {p.colorways.map((c) => (
                  <li key={c.id} className="text-sm">
                    <span className={c.active ? '' : 'text-faint line-through'}>{c.customerName}</span>
                    {c.dyeHouseName ? <span className="text-faint"> · {c.dyeHouseName}</span>
                      : c.inHouseMatch ? <span className="text-warn"> · in-house match</span> : null}
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
                    <span>{b.component.name}{b.component.vendor ? <span className="text-faint"> · {b.component.vendor.name}</span> : null}</span>
                    <span className="tnum text-muted">
                      {Number(b.qtyPerUnit) === 0 ? <span className="italic text-faint">unknown</span> : `${b.qtyPerUnit} ${b.component.unitOfMeasure}`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="px-4 py-3 text-sm text-faint sm:px-5">No bill of materials yet — Studio Mouse will ask.</p>
          )}
        </Card>
      ))}
    </Page>
  )
}
