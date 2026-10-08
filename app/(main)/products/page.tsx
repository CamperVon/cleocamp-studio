import { filesFor } from '@/lib/files'
import { FileLinks } from '@/app/ui/file-links'
import { AddFileTo } from '../files/file-controls'
import { SkuModeToggle } from './sku-mode'
import { kitsByProduct } from '@/lib/kits'
import { styleReport } from '@/lib/style-report'
import { asSkuDisplayMode, skuText } from '@/lib/po-snapshot'
import { lineScopeLabel } from '@/lib/bom'
import { db } from '@/lib/db'
import { poLineLabel } from '@/lib/po'
import { Page, Card, Chip, Value, Money, Thumb } from '@/app/ui/primitives'
import { laDay, laMidnight } from '@/lib/dates'
import { PageChat } from '@/app/ui/page-chat'

export const dynamic = 'force-dynamic'

const STATUS_TONE = {
  ACTIVE: 'accent', SAMPLING: 'warn', DEVELOPMENT: 'neutral', SUNSETTED: 'neutral',
} as const

/** Stock in pink; none (or oversold) in bold red. Brandon, 2 Oct 2026. */
const stockTone = (n: number) => (n <= 0 ? 'font-bold text-urgent' : 'text-accent')

export default async function Products() {
  const [productFiles, kits, styleLines] = await Promise.all([filesFor('product'), kitsByProduct(), styleReport()])
  const stylesClear = styleLines[0]?.startsWith('Style system: nothing')
  const [products, pos, runs, sales, defaults] = await Promise.all([
    db.product.findMany({
      include: {
        style: { select: { number: true, status: true } },
        colorways: { orderBy: { customerName: 'asc' } },
        variants: { include: { colorway: true } },
        bomLines: { include: { component: { include: { vendor: true } } } },
      },
    }),
    db.purchaseOrder.findMany({
      where: { status: { in: ['DRAFT', 'SENT', 'PARTIALLY_RECEIVED'] } },
      include: { vendor: true, lines: { orderBy: { id: 'asc' }, include: { component: true, productVariant: { include: { product: true, colorway: true } } } } },
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
    db.documentDefaults.findUnique({ where: { id: 'singleton' }, select: { skuDisplayMode: true } }),
  ])
  const skuMode = asSkuDisplayMode(defaults?.skuDisplayMode)

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
    const flags: Array<{ tone: 'urgent' | 'warn'; text: string; oversold?: boolean }> = []
    if (oversold.length) {
      flags.push({
        tone: 'urgent',
        text: `${oversold.length} variant${oversold.length > 1 ? 's' : ''} oversold: ${oversold
          .map((v) => [v.colorway?.customerName, v.size].filter(Boolean).join(' ') + ` (${v.onHandQty})`)
          .join(', ')}`,
        oversold: true,
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

    return { p, relatedPos, relatedRuns, soldTotal, onHand, weeks, flags }
  })

  // A to Z within each group (Brandon, 4 Oct 2026). Anything urgent still
  // shows on its closed line, so nothing that needs attention sinks.
  rows.sort((a, b) => a.p.name.localeCompare(b.p.name, 'en', { sensitivity: 'base', numeric: true }))

  // One line per product, opened on a tap. Brandon, 26 Sept 2026: "make the
  // products drop down to make it easier on the eye." Anything flagged
  // urgent still shows on the closed line, so a problem is never folded away.
  const groups = [
    { title: 'Selling', items: rows.filter((r) => r.p.status === 'ACTIVE') },
    { title: 'In the works', items: rows.filter((r) => r.p.status === 'DEVELOPMENT' || r.p.status === 'SAMPLING') },
    { title: 'Retired', items: rows.filter((r) => r.p.status === 'SUNSETTED') },
  ].filter((g) => g.items.length)

  return (
    <Page title="Products" lede="A to Z. Tap a product for what is on order, in production, and what Studio Mouse would flag.">
      <PageChat page="Products" placeholder="A note for Mouse…" />
      {/* The style list with photos, as a PDF (Brandon, 8 Oct 2026). */}
      <div className="flex flex-wrap items-center gap-2">
        <a href="/styles/pdf" className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-bg">Styles PDF</a>
        <a href="/styles" className="rounded-lg border border-line px-3 py-2 text-sm">Styles page</a>
      </div>
      <SkuModeToggle mode={skuMode} />
      {/* Style numbers still to settle (lib/style-report.ts), folded; the
          partner reference is its own printable page, kept free of these. */}
      <Card>
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-2.5 px-4 py-3 text-sm hover:bg-sunk sm:px-5 [&::-webkit-details-marker]:hidden">
            <span aria-hidden className="text-xs text-faint transition-transform group-open:rotate-90">▸</span>
            <span className="flex-1">Style numbers{stylesClear ? <span className="text-muted">: nothing to settle</span> : <span className="text-warn">: {styleLines.length} thing{styleLines.length === 1 ? '' : 's'} to settle</span>}</span>
            <a href="/styles" className="text-xs text-accent underline underline-offset-2">Partner reference</a>
          </summary>
          <ul className="flex flex-col gap-1.5 border-t border-line px-4 py-3 text-sm sm:px-5">
            {styleLines.map((l, i) => <li key={i}>{l}</li>)}
          </ul>
        </details>
      </Card>
      {groups.map((g) => (
        <Card key={g.title} title={`${g.title} (${g.items.length})`}>
          <ul className="divide-y divide-line">
            {g.items.map(({ p, relatedPos, relatedRuns, soldTotal, onHand, weeks, flags }) => {
              const urgent = flags.filter((f) => f.tone === 'urgent').length
              return (
                <li key={p.id} data-rec={p.id}>
                  <details className="group">
                    <summary className="flex cursor-pointer list-none items-center gap-2.5 px-4 py-3 hover:bg-sunk sm:px-5 [&::-webkit-details-marker]:hidden">
                      <span aria-hidden className="text-xs text-faint transition-transform group-open:rotate-90">▸</span>
                      <Thumb src={p.variants.find((v) => v.imageUrl)?.imageUrl} size={40} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">
                          {p.name}
                          {/* The style number (docs/style-system/); a proposed one says so. */}
                          {p.style ? <span className="ml-1.5 text-xs font-normal text-faint">{p.style.number}{p.style.status === 'PROPOSED' ? ' proposed' : ''}</span> : null}
                        </span>
                        <span className="block text-xs text-muted">
                          <span className={`tnum ${stockTone(onHand)}`}>{onHand} on hand</span> · <span className="tnum">{soldTotal}</span> sold in 8 wks
                          {relatedPos.length || relatedRuns.length ? ` · ${relatedPos.length + relatedRuns.length} on order` : ''}
                          {productFiles.get(p.id)?.length ? ` · ${productFiles.get(p.id)!.length} file${productFiles.get(p.id)!.length === 1 ? '' : 's'}` : ''}
                        </span>
                        {/* Oversold shows on the closed line (Brandon, 2 Oct 2026: "visible w/o having to click"). */}
                        {flags.filter((f) => f.oversold).map((f, i) => (
                          <span key={i} className="block text-xs font-bold text-urgent">{f.text}</span>
                        ))}
                      </span>
                      {urgent ? <Chip tone="urgent">{urgent > 1 ? `! ${urgent}` : "!"}</Chip> : flags.length ? <Chip tone="warn">?</Chip> : null}
                      <Chip tone={STATUS_TONE[p.status]}>{p.status.toLowerCase()}</Chip>
                    </summary>
                    <div className="border-t border-line">
                      {/* Tech packs and the like, kept in Files and added from here (Brandon, 8 Oct 2026). */}
                      <div className="border-b border-line px-4 py-2.5 sm:px-5">
                        {productFiles.get(p.id)?.length
                          ? <FileLinks files={productFiles.get(p.id)} />
                          : <p className="text-xs text-faint">No files yet: tech pack, spec sheet, photos.</p>}
                        <AddFileTo kind="product" recordId={p.id} />
                      </div>
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
                        <div><dt className="text-xs text-faint">On hand</dt><dd className={`tnum ${stockTone(onHand)}`}>{onHand}</dd></div>
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

                      {kits.get(p.id) ? (
                        // A kit (KitPart): sold as its parts together. It can be made up
                        // only while every part is on hand, so the lower count wins.
                        <div className="border-b border-line px-4 py-3 sm:px-5">
                          <p className="mb-1.5 text-xs text-faint">Made up from {kits.get(p.id)!.parts.join(' + ')}. Can be made up now:</p>
                          <ul className="flex flex-col gap-1">
                            {kits.get(p.id)!.lines.map((k, i) => (
                              <li key={i} className="flex flex-wrap justify-between gap-x-3 text-sm">
                                <span>{k.colour ?? 'One variant'}</span>
                                <span className="text-muted">
                                  <span className={`tnum ${k.available === null ? 'italic text-faint' : stockTone(k.available)}`}>{k.available ?? 'unknown'}</span>
                                  <span className="text-xs text-faint"> ({k.parts.map((x) => `${x.name.split(' — ')[0].replace(/^Bateau |^Petite Bateau /, '').toLowerCase()} ${x.onHand ?? x.problem ?? '?'}`).join(', ')})</span>
                                </span>
                              </li>
                            ))}
                          </ul>
                          {kits.get(p.id)!.shared.length ? <p className="mt-1.5 text-xs text-muted">Each is &ldquo;up to&rdquo;: {kits.get(p.id)!.shared.join('; ')}.</p> : null}
                        </div>
                      ) : null}

                      {p.variants.length ? (
                        <details className="group/skus border-b border-line">
                          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-xs text-faint sm:px-5 [&::-webkit-details-marker]:hidden">
                            <span aria-hidden className="transition-transform group-open/skus:rotate-90">▸</span>
                            SKUs ({p.variants.length}){p.variants.some((v) => !v.newSku) ? <span className="text-warn"> · {p.variants.filter((v) => !v.newSku).length} without a new SKU</span> : null}
                          </summary>
                          <ul className="flex flex-col gap-1 px-4 pb-3 sm:px-5">
                            {[...p.variants].sort((a, b) => (a.newSku ?? a.sku ?? '~').localeCompare(b.newSku ?? b.sku ?? '~')).map((v) => (
                              <li key={v.id} className="flex flex-wrap justify-between gap-x-3 text-sm">
                                <span>{[v.colorway?.customerName, v.size].filter(Boolean).join(' / ') || 'One variant'}</span>
                                <span className={`font-mono text-xs ${v.newSku ? 'text-ink' : 'text-faint'}`}>{skuText(v, skuMode) ?? 'no SKU'}</span>
                              </li>
                            ))}
                          </ul>
                        </details>
                      ) : null}

                      {p.colorways.length ? (
                        <div className="border-b border-line px-4 py-3 sm:px-5">
                          <p className="mb-2 text-xs text-faint">Colourways — customer name · dye house name</p>
                          <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
                            {p.colorways.map((c) => (
                              <li key={c.id} className="text-sm">
                                <span className={c.active ? '' : 'text-faint line-through'}>{c.customerName}</span>
                                {c.colorCode ? <span className="font-mono text-xs text-faint"> {c.colorCode}</span> : null}
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
                                <span>{b.component.name}{lineScopeLabel(b) ? <span className="text-muted">{lineScopeLabel(b)}</span> : null}{b.component.vendor ? <span className="text-faint"> · {b.component.vendor.name}</span> : null}</span>
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
                    </div>
                  </details>
                </li>
              )
            })}
          </ul>
        </Card>
      ))}
    </Page>
  )
}
