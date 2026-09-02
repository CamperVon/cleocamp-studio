import { db } from '@/lib/db'

/**
 * QuickBooks — read-only for now: cash, receivables, payables, revenue.
 *
 * AUTHENTICATION. Intuit uses OAuth 2.0 with a rotating refresh token: every
 * refresh returns a new one and invalidates the old immediately. Lose the new
 * one and the connection is dead. So refreshing and storing are a single
 * operation, and the store is the database, never an env var.
 *
 * Access tokens last an hour; refresh tokens last 100 days from last use.
 *
 * NOTE ON TRUST. Cleo Couture's books were mid-reconciliation as of Sept 2026 —
 * QuickBooks reported $0 of August income against Shopify's $67,744.80. Figures
 * from here are labelled with their as-of date and should not be treated as
 * settled until the bookkeeper signs off.
 */

const AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2'
const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'
const API_BASE = 'https://quickbooks.api.intuit.com/v3/company'
const SCOPE = 'com.intuit.quickbooks.accounting'
const MINOR_VERSION = '75'

export class QuickBooksNotConnected extends Error {
  constructor(msg = 'QuickBooks is not connected yet.') {
    super(msg)
    this.name = 'QuickBooksNotConnected'
  }
}

function creds() {
  const clientId = process.env.QBO_CLIENT_ID
  const clientSecret = process.env.QBO_CLIENT_SECRET
  const redirectUri = process.env.QBO_REDIRECT_URI
  if (!clientId || !clientSecret || !redirectUri) {
    throw new QuickBooksNotConnected('QBO_CLIENT_ID, QBO_CLIENT_SECRET and QBO_REDIRECT_URI must be set.')
  }
  return { clientId, clientSecret, redirectUri }
}

export function isConfigured() {
  try { creds(); return true } catch { return false }
}

/** Where to send the user to authorise. `state` guards against CSRF. */
export function authorizeUrl(state: string) {
  const { clientId, redirectUri } = creds()
  const p = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    scope: SCOPE,
    redirect_uri: redirectUri,
    state,
  })
  return `${AUTH_URL}?${p}`
}

async function tokenRequest(body: URLSearchParams) {
  const { clientId, clientSecret } = creds()
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
    },
    body,
  })
  const json = await res.json()
  if (!res.ok) throw new Error(`Intuit token ${res.status}: ${JSON.stringify(json)}`)
  return json as {
    access_token: string
    refresh_token: string
    expires_in: number
    x_refresh_token_expires_in: number
  }
}

/** Exchange the one-time code from the callback for tokens, and store them. */
export async function completeConnection(code: string, realmId: string) {
  const { redirectUri } = creds()
  const t = await tokenRequest(
    new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
  )
  const data = {
    realmId,
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    accessExpiresAt: new Date(Date.now() + t.expires_in * 1000),
    refreshExpiresAt: new Date(Date.now() + t.x_refresh_token_expires_in * 1000),
    lastRefreshedAt: new Date(),
    lastError: null,
  }
  await db.quickBooksConnection.upsert({ where: { id: 'singleton' }, create: { id: 'singleton', ...data }, update: data })
  return { realmId }
}

/**
 * A valid access token, refreshing if needed.
 *
 * The new refresh token is written in the same step it is received. Any other
 * order risks using a token that has already been invalidated, which ends the
 * connection silently.
 */
export async function getAccessToken(): Promise<{ token: string; realmId: string }> {
  const conn = await db.quickBooksConnection.findUnique({ where: { id: 'singleton' } })
  if (!conn) throw new QuickBooksNotConnected()

  // Refresh a minute early so a call cannot start on a token that expires
  // mid-flight.
  if (conn.accessExpiresAt.getTime() > Date.now() + 60_000) {
    return { token: conn.accessToken, realmId: conn.realmId }
  }

  try {
    const t = await tokenRequest(
      new URLSearchParams({ grant_type: 'refresh_token', refresh_token: conn.refreshToken }),
    )
    const updated = await db.quickBooksConnection.update({
      where: { id: 'singleton' },
      data: {
        accessToken: t.access_token,
        refreshToken: t.refresh_token,
        accessExpiresAt: new Date(Date.now() + t.expires_in * 1000),
        refreshExpiresAt: new Date(Date.now() + t.x_refresh_token_expires_in * 1000),
        lastRefreshedAt: new Date(),
        lastError: null,
      },
    })
    return { token: updated.accessToken, realmId: updated.realmId }
  } catch (e) {
    await db.quickBooksConnection.update({
      where: { id: 'singleton' },
      data: { lastError: (e as Error).message.slice(0, 500) },
    })
    throw e
  }
}

async function qboGet(path: string, params: Record<string, string> = {}) {
  const { token, realmId } = await getAccessToken()
  const q = new URLSearchParams({ ...params, minorversion: MINOR_VERSION })
  const res = await fetch(`${API_BASE}/${realmId}/${path}?${q}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`QuickBooks ${path} ${res.status}: ${(await res.text()).slice(0, 300)}`)
  return res.json()
}

/** Walk a QuickBooks report and total the rows whose account type matches. */
function sumReport(report: any, wanted: (name: string) => boolean): number {
  let total = 0
  const walk = (rows: any[]) => {
    for (const r of rows ?? []) {
      if (r.Rows?.Row) walk(r.Rows.Row)
      const cols = r.ColData ?? r.Summary?.ColData
      if (!cols?.length) continue
      const label = String(cols[0]?.value ?? '')
      if (!wanted(label)) continue
      const v = parseFloat(String(cols[cols.length - 1]?.value ?? '0').replace(/,/g, ''))
      if (!Number.isNaN(v)) total += v
    }
  }
  walk(report?.Rows?.Row ?? [])
  return total
}

const cents = (n: number) => BigInt(Math.round(n * 100))

export async function fetchPosition() {
  const today = new Date().toISOString().slice(0, 10)
  const yearStart = today.slice(0, 4) + '-01-01'
  const monthStart = today.slice(0, 7) + '-01'

  const [accounts, plYtd, plMtd] = await Promise.all([
    qboGet('query', { query: "select * from Account where AccountType in ('Bank','Accounts Receivable','Accounts Payable') maxresults 200" }),
    qboGet('reports/ProfitAndLoss', { start_date: yearStart, end_date: today }),
    qboGet('reports/ProfitAndLoss', { start_date: monthStart, end_date: today }),
  ])

  const list: any[] = accounts?.QueryResponse?.Account ?? []
  const sumType = (type: string) =>
    list.filter((a) => a.AccountType === type).reduce((n, a) => n + Number(a.CurrentBalance ?? 0), 0)

  const income = (r: any) => sumReport(r, (l) => /total income|total revenue/i.test(l))
  const expense = (r: any) => sumReport(r, (l) => /total expenses/i.test(l))

  return {
    asOf: today,
    cashCents: cents(sumType('Bank')),
    arCents: cents(sumType('Accounts Receivable')),
    apCents: cents(sumType('Accounts Payable')),
    revenueYtdCents: cents(income(plYtd)),
    revenueMtdCents: cents(income(plMtd)),
    expensesMtdCents: cents(expense(plMtd)),
    accounts: list.map((a) => ({ name: a.Name, type: a.AccountType, balance: Number(a.CurrentBalance ?? 0) })),
  }
}

/** Store today's position so pages read from the database, not from Intuit. */
export async function snapshotPosition() {
  const p = await fetchPosition()
  const forDate = new Date(p.asOf + 'T00:00:00Z')
  const data = {
    cashCents: p.cashCents, arCents: p.arCents, apCents: p.apCents,
    revenueMtdCents: p.revenueMtdCents, revenueYtdCents: p.revenueYtdCents,
    expensesMtdCents: p.expensesMtdCents,
    raw: { accounts: p.accounts } as never,
  }
  await db.financialSnapshot.upsert({ where: { forDate }, create: { forDate, ...data }, update: data })
  return p
}
