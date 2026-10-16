import { db } from '@/lib/db'
import { Card, Empty, Fold, Page } from '@/app/ui/primitives'

export const dynamic = 'force-dynamic'

/**
 * The 16 Oct 2026 re-key, old to new (docs/style-system/crosswalk-2026-10-16.csv
 * is the same list, as a file). Read from the database, so it is always what
 * the app holds: each retired number, what replaced it, and every SKU's three
 * generations (legacy, the 8 Oct one, today's).
 */
export default async function Crosswalk() {
  const [retired, styles] = await Promise.all([
    db.retiredStyleNumber.findMany({ orderBy: { number: 'asc' } }),
    db.style.findMany({
      select: {
        number: true, name: true,
        products: { orderBy: { name: 'asc' }, select: { name: true, variants: { where: { OR: [{ previousSku: { not: null } }, { newSku: { not: null } }] }, orderBy: [{ colorway: { customerName: 'asc' } }, { size: 'asc' }], select: { id: true, sku: true, previousSku: true, newSku: true, size: true, colorway: { select: { customerName: true } } } } } },
      },
    }),
  ])
  const byNumber = new Map(styles.map((s) => [s.number, s]))
  // A split number (BG101) points at its first replacement; the others are new styles with no retired number of their own.
  const rows = retired.map((r) => ({ old: r.number, note: r.note, styles: r.replacedBy ? [r.replacedBy, ...(r.note?.match(/[A-Z]{3}\d{3}/g) ?? [])].filter((n, i, a) => a.indexOf(n) === i && byNumber.has(n)).map((n) => byNumber.get(n)!) : [] }))

  return (
    <Page title="Old style numbers → new" lede="On 16 Oct 2026 every style number moved to the new system (TP101 → TCO101). Old numbers and SKUs are retired, never reused, and still find their product in search.">
      <Card title={`${retired.length} retired numbers`}>
        {rows.length === 0 ? <Empty>The re-key has not run yet.</Empty> : (
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.old}>
                <Fold summary={
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-mono text-sm text-muted line-through decoration-1">{r.old}</span>
                    <span className="text-muted">→</span>
                    {r.styles.length ? r.styles.map((s) => <span key={s.number} className="text-sm"><span className="font-mono font-medium">{s.number}</span> {s.name}</span>) : <span className="text-sm text-warn">no number ({r.note})</span>}
                  </span>
                }>
                  {r.styles.flatMap((s) => s.products.flatMap((p) => p.variants.map((v) => ({ s, p, v })))).length === 0
                    ? <p className="px-4 pb-3 text-xs text-muted sm:px-5">No SKUs yet.</p>
                    : (
                      <ul className="px-4 pb-3 text-xs sm:px-5">
                        {r.styles.flatMap((s) => s.products.flatMap((p) => p.variants.map((v) => (
                          <li key={v.id} className="flex flex-wrap items-baseline justify-between gap-x-3 border-t border-line py-1.5">
                            <span className="text-muted">{[p.name, v.colorway?.customerName, v.size].filter(Boolean).join(' / ')}</span>
                            <span className="font-mono">{v.newSku ?? '—'} <span className="text-muted">was {[v.previousSku, v.sku].filter(Boolean).join(', ') || '—'}</span></span>
                          </li>
                        ))))}
                      </ul>
                    )}
                </Fold>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </Page>
  )
}
