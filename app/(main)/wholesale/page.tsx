import { chargedDifferently, dollars, heldBackFor, loadLineSheet, onThePdf, variantsFor, wholesaleText } from '@/lib/line-sheet'
import { db } from '@/lib/db'
import { Page, Card, Chip, Empty, Money, Fold } from '@/app/ui/primitives'
import { LineSheetRowEditor, OneOffButton, PriceEdit, RestoreRow } from './line-sheet-row'
import { AccountEditor, NewAccount, RestoreAccount } from './account-controls'

export const dynamic = 'force-dynamic'

/**
 * What has shipped to wholesale and consignment accounts, and what's been
 * paid. Seeded 4 Sept 2026 from the studio's own spreadsheet, last three
 * months only — see git history for the full account list if older history
 * is ever needed, it stays in the sheet rather than living twice.
 *
 * Deliberately reads no count from Component, ProductVariant or
 * InventoryEvent — Brandon: "do NOT change inventory in any way." This page
 * (and the tools behind it) never touch a count; Shopify stays the only
 * place on-hand lives. It reads only the prices off products and variants.
 *
 * The price list is what invoice_wholesale charges, and the app is its
 * master copy (Brandon, 28 Sept 2026: "Let's have these prices in a
 * wholesale tab"). Loaded from the Jan 2026 line sheet; changed by telling
 * Mouse, which uses set_wholesale_price.
 */
/** "12 on hand", "none on hand", "none on hand · 83 pre-ordered". Negative on-hand is pre-orders waiting. */
function stockWords(n: number | null): string {
  if (n == null) return ''
  if (n > 0) return `${n} on hand`
  return n === 0 ? 'none on hand' : `none on hand · ${-n} pre-ordered`
}

/** The window an off-list invoice price is flagged in. */
const sixMonthsAgo = () => Date.now() - 180 * 86_400_000

export default async function Wholesale() {
  // Invoices sent through Shopify: paid when Shopify says so. A failed check
  // leaves them as they were rather than blanking the page.
  await import('@/lib/wholesale-invoices').then((m) => m.syncWholesalePayments()).catch(() => {})
  const accounts = await db.wholesaleAccount.findMany({
    where: { active: true },
    orderBy: { name: 'asc' },
    include: { shipments: { include: { lines: true }, orderBy: { sentAt: 'desc' } } },
  })
  const removedAccounts = await db.wholesaleAccount.findMany({ where: { active: false }, orderBy: { name: 'asc' }, select: { id: true, name: true } })
  // Things we sell: active, with a retail price (the muslin bodies are parts).
  const products = await db.product.findMany({
    where: { status: 'ACTIVE', retailPriceCents: { not: null } },
    orderBy: { name: 'asc' },
    select: {
      id: true, name: true, retailPriceCents: true, wholesalePriceCents: true,
      variants: {
        orderBy: [{ colorway: { customerName: 'asc' } }, { size: 'asc' }],
        select: { id: true, size: true, retailPriceCents: true, wholesalePriceCents: true, colorway: { select: { customerName: true } } },
      },
    },
  })
  const everyRow = await loadLineSheet({ includeHidden: true })
  const sheet = { ...everyRow, lines: everyRow.lines.filter((l) => !l.hidden) }
  const removed = everyRow.lines.filter((l) => l.hidden)
  const soldOutButListed = sheet.lines.filter((l) => /in stock/i.test(l.availability) && l.onHand != null && l.onHand <= 0)
  const heldBack = sheet.lines.filter((l) => !onThePdf(l))
  const since = sixMonthsAgo()
  const oneOffs = new Set((await db.note.findMany({ where: { entityId: { startsWith: 'oneoff-price:' } }, select: { entityId: true } })).map((n) => n.entityId!))
  const offList = chargedDifferently(products, accounts.flatMap((a) => a.shipments
    .filter((s) => s.sentAt.getTime() >= since)
    .map((s) => ({ id: s.id, sentAt: s.sentAt, invoiceName: s.invoiceName, account: a.name, lines: s.lines }))), oneOffs)
  const name = (l: { item: string; colorLabel: string }) => [l.item, l.colorLabel].filter(Boolean).join(' ')
  // Where a wholesale price typed on a line sheet row goes: the colour's own
  // variants when that colour is priced apart (Bean Bag Silver), else the
  // whole product, which moves every colour.
  const priceFor = (l: (typeof sheet.lines)[number]) => {
    const p = products.find((x) => x.id === l.productId)
    if (!p) return undefined
    const vs = variantsFor(p, l.colorway)
    const apart = !!l.colorway && vs.some((v) => v.wholesalePriceCents != null)
    return apart
      ? { productId: p.id, variantIds: vs.map((v) => v.id), scope: `${p.name} ${l.colorway} only` }
      : { productId: p.id, scope: `every ${p.name}` }
  }
  const alerts = soldOutButListed.length + heldBack.length + offList.length
  const unpriced = products.filter((p) => p.wholesalePriceCents == null && !p.variants.some((v) => v.wholesalePriceCents != null)).length

  const row = (a: (typeof accounts)[number]) => {
    const totalOwed = a.shipments.reduce((n, s) => {
      if (s.paid) return n
      const shipmentTotal = s.lines.reduce((m, l) => {
        // Consignment only owes on what's actually sold; wholesale owes
        // regardless of whether it's sold yet.
        if (a.type === 'CONSIGNMENT' && !l.soldAt) return m
        return m + (l.wholesaleCents ?? 0)
      }, 0)
      return n + shipmentTotal
    }, 0)
    const unconfirmed = a.shipments.filter((s) => s.paid === null).length

    return (
      <li key={a.id}>
        <Fold
          summary={
            <span className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-medium">{a.name}</span>
                <Chip tone={a.type === 'CONSIGNMENT' ? 'accent' : 'neutral'}>
                  {a.type === 'CONSIGNMENT' ? `Consignment${a.commissionSplit ? ` · ${a.commissionSplit}` : ''}` : 'Wholesale'}
                </Chip>
                {unconfirmed ? <span className="text-xs text-warn">{unconfirmed} not confirmed</span> : null}
              </span>
              <span className={`shrink-0 ${totalOwed ? 'font-semibold' : 'text-muted'}`}><Money cents={totalOwed} /></span>
            </span>
          }
        >
        <div className="px-4 pb-3.5 sm:px-5">
        <p className="text-xs text-muted">
          {[a.contactName, a.email, a.address].filter(Boolean).join(' · ') || 'No contact on file'}
          {' · '}{a.shipments.length ? `${a.shipments.length} shipment${a.shipments.length === 1 ? '' : 's'}` : 'nothing shipped yet'}
        </p>
        {a.shipments.length ? <ul className="mt-2 flex flex-col gap-1.5 border-t border-line pt-2">
          {a.shipments.map((s) => {
            const total = s.lines.reduce((n, l) => n + (l.wholesaleCents ?? 0), 0)
            const soldOfLines = s.lines.filter((l) => l.soldAt).length
            return (
              <li key={s.id} className="flex items-start justify-between gap-3 text-xs">
                <div>
                  <span className="text-muted">
                    {s.sentAt.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' })}
                  </span>
                  {' · '}
                  {s.lines.length} line{s.lines.length === 1 ? '' : 's'}
                  {a.type === 'CONSIGNMENT' ? ` · ${soldOfLines} sold` : ''}
                  {s.notes ? ` · ${s.notes}` : ''}
                </div>
                <div className="shrink-0 text-right">
                  <span className="tnum">{total ? `$${(total / 100).toFixed(2)}` : '—'}</span>
                  <span className={s.paid === true ? ' text-muted' : s.paid === false ? ' text-urgent' : ' text-faint'}>
                    {' · '}
                    {s.paid === true ? `paid${s.paidAt ? ' ' + s.paidAt.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }) : ''}` : s.paid === false ? 'unpaid' : 'not confirmed'}
                  </span>
                </div>
              </li>
            )
          })}
        </ul> : null}
        <AccountEditor id={a.id} start={{
          name: a.name, type: a.type, commissionSplit: a.commissionSplit ?? '', contactName: a.contactName ?? '',
          email: a.email ?? '', address: a.address ?? '', notes: a.notes ?? '',
        }} />
        </div>
        </Fold>
      </li>
    )
  }

  const totalOutstanding = accounts.reduce((n, a) => {
    const owed = a.shipments.reduce((m, s) => {
      if (s.paid) return m
      const t = s.lines.reduce((k, l) => k + ((a.type === 'CONSIGNMENT' && !l.soldAt) ? 0 : (l.wholesaleCents ?? 0)), 0)
      return m + t
    }, 0)
    return n + owed
  }, 0)
  const unconfirmedCount = accounts.reduce((n, a) => n + a.shipments.filter((s) => s.paid === null).length, 0)

  return (
    <Page
      title="Wholesale"
      lede="What stores pay, what has shipped to them, and what's been paid — not inventory, that stays in Shopify."
    >
      <div className="flex flex-wrap gap-3">
        <div className="flex-1 rounded-xl border border-line bg-surface px-4 py-3">
          <p className="text-xs text-faint">Outstanding (confirmed unpaid + consignment sold)</p>
          <p className="mt-1 text-xl font-semibold tnum">${(totalOutstanding / 100).toFixed(2)}</p>
        </div>
        {unconfirmedCount ? (
          <div className="flex-1 rounded-xl border border-line bg-surface px-4 py-3">
            <p className="text-xs text-faint">Payment status not confirmed</p>
            <p className="mt-1 text-xl font-semibold tnum">{unconfirmedCount} shipment{unconfirmedCount === 1 ? '' : 's'}</p>
          </div>
        ) : null}
      </div>

      <Card>
        <Fold
          summary={
            <span className="flex items-center justify-between gap-3">
              <span className="font-serif text-[17px] italic text-accent">Price list</span>
              <span className="text-xs text-muted">{products.length} products{unpriced ? ` · ${unpriced} not set` : ''}</span>
            </span>
          }
        >
        <p className="border-b border-line px-4 py-2.5 text-xs text-muted sm:px-5">
          What a store pays, and what Mouse invoices unless you name a price for one order. Tap a price to change it, or
          {' '}tell Mouse (&ldquo;wholesale on the Cleo Tee is $56&rdquo;). Shipped orders add $25 shipping &amp; handling, waived over $2,500.
          {unpriced ? <span className="text-warn"> {unpriced} not set yet — Mouse will ask.</span> : null}
        </p>
        <ul className="divide-y divide-line">
          {products.map((p) => {
            const byVariant = p.wholesalePriceCents == null && p.variants.some((v) => v.wholesalePriceCents != null)
            const own = p.variants.filter((v) => byVariant || (v.wholesalePriceCents != null && v.wholesalePriceCents !== p.wholesalePriceCents))
            const pct = (w: number | null, r: number | null) => (w != null && r ? ` · ${Math.round((w / r) * 100)}%` : '')
            return (
              <li key={p.id} className="px-4 py-2.5 text-sm sm:px-5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p className="font-medium">{p.name}</p>
                  <p className="ml-auto text-right">
                    {byVariant ? (
                      <span className="text-xs text-muted">by colour &amp; size</span>
                    ) : (
                      <PriceEdit productId={p.id} cents={p.wholesalePriceCents} scope={`every ${p.name}`}>
                        {p.wholesalePriceCents == null
                          ? <span className="text-xs text-warn">not set</span>
                          : <span className="font-semibold"><Money cents={p.wholesalePriceCents} /></span>}
                      </PriceEdit>
                    )}
                    {byVariant ? null : <span className="text-xs text-faint"> · retail <Money cents={p.retailPriceCents} />{pct(p.wholesalePriceCents, p.retailPriceCents)}</span>}
                  </p>
                </div>
                {own.length ? (
                  <ul className="mt-1 flex flex-col gap-0.5">
                    {own.map((v) => {
                      const retail = v.retailPriceCents ?? p.retailPriceCents
                      return (
                        <li key={v.id} className="flex items-baseline justify-between gap-3 text-xs">
                          <span className="text-muted">{[v.colorway?.customerName, v.size].filter(Boolean).join(' / ') || 'One size'}</span>
                          <span className="shrink-0">
                            <PriceEdit productId={p.id} variantIds={[v.id]} cents={v.wholesalePriceCents}
                              scope={[p.name, v.colorway?.customerName, v.size].filter(Boolean).join(' / ') + ' only'}>
                              {v.wholesalePriceCents == null ? <span className="text-warn">not set</span> : <Money cents={v.wholesalePriceCents} />}
                            </PriceEdit>
                            <span className="text-faint"> · retail <Money cents={retail} />{pct(v.wholesalePriceCents, retail)}</span>
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                ) : null}
              </li>
            )
          })}
        </ul>
        </Fold>
      </Card>

      <Card>
        <Fold
          summary={
            <span className="flex items-center justify-between gap-3">
              <span className="shrink-0 whitespace-nowrap font-serif text-[17px] italic text-accent">Line sheet</span>
              <span className="text-xs text-muted">
                {sheet.lines.length} piece{sheet.lines.length === 1 ? '' : 's'}
                {alerts ? <span className="text-warn"> · see alerts</span> : null}
              </span>
            </span>
          }
        >
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-4 py-2.5 text-xs text-muted sm:px-5">
            <a href="/wholesale/line-sheet/pdf" target="_blank" rel="noreferrer" className="font-medium text-accent underline">Open the PDF</a>
            <a href="/wholesale/line-sheet/pdf?download=1" className="text-accent underline">Download</a>
            <a href="/wholesale/line-sheet/xlsx" className="text-accent underline">Excel</a>
            <span>Wholesale from the price list, suggested retail from Shopify, both read live. New products and colours on Shopify join by themselves. Tap a piece to change its words or remove it; tell Mouse to change a price or send the sheet to a store.</span>
          </div>
          {alerts ? (
            <div className="flex flex-col gap-2.5 border-b border-line px-4 py-2.5 text-xs sm:px-5">
              <p className="font-medium text-warn">Alerts</p>
              {heldBack.length ? (
                <p className="text-muted">
                  <span className="text-ink">Not on the PDF yet:</span> {heldBack.map((l) => `${name(l)} (needs ${heldBackFor(l).join(' and ')})`).join('; ')}. Tap the piece below to fill it in.
                </p>
              ) : null}
              {soldOutButListed.length ? (
                <p className="text-muted">
                  <span className="text-ink">None on hand, but the PDF tells stores it&rsquo;s available now:</span> {soldOutButListed.map(name).join(', ')}. Tap one to change its availability (&ldquo;Ships in 3 weeks&rdquo;), or check the count.
                </p>
              ) : null}
              {offList.map((o) => (
                <div key={o.key} className="flex items-start justify-between gap-3 text-muted">
                  <p>
                    <span className="text-ink">Invoiced off the list:</span> {o.product} at {o.charged.map(dollars).join(' and ')} to {o.account}{o.invoice ? ` on ${o.invoice}` : ''}
                    {' '}({o.sentAt.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' })}), list {o.list.map(dollars).join(' / ')}. The sheet prints the list. A one-off deal? Tap to clear this. A new price? Tell Mouse.
                  </p>
                  <OneOffButton priceKey={o.key} product={o.product} charged={o.charged.map(dollars).join(' and ')} account={o.account} invoice={o.invoice} list={o.list.map(dollars).join(' / ')} />
                </div>
              ))}
            </div>
          ) : null}
          <ul className="divide-y divide-line">
            {sheet.lines.map((l) => {
              const warn = /in stock/i.test(l.availability) && l.onHand != null && l.onHand <= 0
              return (
                <LineSheetRowEditor key={l.id} row={{
                  id: l.id, linked: !!l.productId, item: l.item, colorLabel: l.colorLabel, description: l.ownDescription,
                  fromShopify: !l.ownDescription.trim() ? l.description : '',
                  sizing: l.sizing, minOrder: l.minOrder, commission: l.commission, availability: l.availability,
                  wholesale: l.wholesaleCents != null ? String(l.wholesaleCents / 100) : '', msrp: l.msrp, price: priceFor(l),
                }}>
                <span className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0">
                    <span className="font-medium">{l.item}</span> <span className="text-muted">{l.colorLabel}</span>
                    <span className={`block text-xs ${warn ? 'text-warn' : 'text-faint'}`}>
                      {[stockWords(l.onHand), /^\s*in stock\s*$/i.test(l.availability) ? '' : l.availability].filter(Boolean).join(' · ') || '—'}
                    </span>
                    {!onThePdf(l) ? <span className="block text-xs text-warn">Not on the PDF until it has {heldBackFor(l).join(' and ')}. Tap to add.</span> : null}
                  </span>
                  <span className="shrink-0 text-right text-xs">
                    {l.wholesaleCents != null ? <span className="text-sm font-semibold">{wholesaleText(l)}</span> : <span className="text-warn">no price</span>}
                    <span className="block text-faint">retail {l.retail ?? '—'}</span>
                  </span>
                </span>
                </LineSheetRowEditor>
              )
            })}
          </ul>
          {removed.length ? (
            <div className="border-t border-line py-2">
              <p className="px-4 pb-1 text-xs text-faint sm:px-5">Removed from the sheet</p>
              <ul>{removed.map((l) => <RestoreRow key={l.id} rowId={l.id} label={[l.item, l.colorLabel].filter(Boolean).join(' · ')} />)}</ul>
            </div>
          ) : null}
        </Fold>
      </Card>

      <Card>
        <Fold
          summary={
            <span className="flex items-center justify-between gap-3">
              <span className="font-serif text-[17px] italic text-accent">Accounts</span>
              <span className="text-xs text-muted">
                {accounts.length} account{accounts.length === 1 ? '' : 's'}
                {totalOutstanding ? <span className="font-medium text-ink"> · <Money cents={totalOutstanding} /> owed</span> : null}
                {unconfirmedCount ? <span className="text-warn"> · {unconfirmedCount} not confirmed</span> : null}
              </span>
            </span>
          }
        >
          <div className="border-t border-line">
            <Fold summary={<span className="text-sm font-medium">+ Add an account</span>}>
              <div className="px-4 pb-4 sm:px-5"><NewAccount /></div>
            </Fold>
          </div>
          {accounts.length === 0 ? (
            <Empty>No wholesale accounts yet.</Empty>
          ) : (
            <ul className="divide-y divide-line border-t border-line">{accounts.map(row)}</ul>
          )}
          {removedAccounts.length ? (
            <div className="border-t border-line py-2">
              <p className="px-4 pb-1 text-xs text-faint sm:px-5">Removed</p>
              <ul>{removedAccounts.map((a) => <RestoreAccount key={a.id} id={a.id} name={a.name} />)}</ul>
            </div>
          ) : null}
        </Fold>
      </Card>
    </Page>
  )
}
