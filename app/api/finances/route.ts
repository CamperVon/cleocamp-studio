import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'

/**
 * Record a financial position from outside the app.
 *
 * This exists so a scheduled Claude routine — which can reach QuickBooks through
 * the account's own connector — can post the figures in without Studio Mouse
 * needing its own Intuit credentials.
 *
 * Guarded by CRON_SECRET rather than a session, for the same reason the nightly
 * job is: nothing out there can hold a login cookie.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = (await req.json()) as {
    asOfDate?: string
    accounts?: Array<{ name: string; type?: string; balance: number }>
    cash?: number
    cardOwed?: number
    receivables?: number
    note?: string
  }

  const asOf = body.asOfDate ?? new Date().toISOString().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    return NextResponse.json({ error: 'asOfDate must be YYYY-MM-DD' }, { status: 400 })
  }

  const accounts = body.accounts ?? []
  // Derive the totals from the accounts when they weren't given, so a caller
  // can send either shape without the two disagreeing.
  const cash =
    body.cash ??
    accounts.filter((a) => (a.type ?? 'Bank') === 'Bank' && a.balance > 0)
      .reduce((n, a) => n + a.balance, 0)
  const cardOwed =
    body.cardOwed ??
    Math.abs(accounts.filter((a) => a.type === 'Credit Card').reduce((n, a) => n + a.balance, 0))

  const c = (n: number) => BigInt(Math.round(n * 100))
  const forDate = new Date(asOf + 'T00:00:00Z')
  const data = {
    cashCents: c(cash),
    apCents: c(cardOwed),
    arCents: body.receivables === undefined ? null : c(body.receivables),
    raw: { source: 'scheduled routine', accounts, note: body.note ?? null } as never,
  }

  await db.financialSnapshot.upsert({
    where: { forDate },
    create: { forDate, ...data },
    update: data,
  })

  // Clear the staleness warning now that fresh figures have arrived.
  await db.alert.updateMany({
    where: { dedupeKey: { in: ['finance:stale', 'finance:none'] }, resolved: false },
    data: { resolved: true, resolvedAt: new Date() },
  })

  return NextResponse.json({ ok: true, asOf, cash, cardOwed, accounts: accounts.length })
}
