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

const money = (raw: unknown): number | null => {
  const v = parseFloat(String(raw ?? '').replace(/,/g, ''))
  return Number.isNaN(v) ? null : v
}

/**
 * The total QuickBooks prints for a whole section, found by its `group` tag
 * ("Income", "COGS", "Expenses", "GrossProfit", "NetOperatingIncome") rather
 * than by matching a label. Tags are stable; printed labels are not.
 */
function sectionTotal(report: any, group: string): number | null {
  let found: number | null = null
  const walk = (rows: any[]) => {
    for (const r of rows ?? []) {
      if (r.group === group) {
        const cols = r.Summary?.ColData ?? r.ColData
        const v = money(cols?.[cols.length - 1]?.value)
        if (v !== null) found = v
      }
      if (r.Rows?.Row) walk(r.Rows.Row)
    }
  }
  walk(report?.Rows?.Row ?? [])
  return found
}

/** Add up the individual account rows inside a section, ignoring its summary. */
function sectionDetailSum(report: any, group: string): number | null {
  let total: number | null = null
  const walk = (rows: any[], inside: boolean) => {
    for (const r of rows ?? []) {
      const here = inside || r.group === group
      if (here && r.ColData && !r.Rows?.Row) {
        const v = money(r.ColData[r.ColData.length - 1]?.value)
        if (v !== null) total = (total ?? 0) + v
      }
      if (r.Rows?.Row) walk(r.Rows.Row, here)
    }
  }
  walk(report?.Rows?.Row ?? [], false)
  return total
}

export type SectionFigure = {
  value: number
  /** Which calculation produced `value`. */
  method: 'detail' | 'derived' | 'summary' | 'none'
  /** Set when the available calculations disagree. Never swallowed. */
  warning: string | null
}

/**
 * Total expenses, computed independently of the headline field.
 *
 * Brandon, 12 Sept 2026: QuickBooks' P&L summary card reports "Total Expenses:
 * $0.00" even when real expenses exist and are itemised below — it appears to
 * be the period-over-period trend calculation defaulting to zero when there is
 * no comparable prior-year period. Confirmed on Cleo Couture's own books the
 * same day: the connector returned totalExpenses 0 against a gross profit of
 * $254,193.71 and net operating income of $216,114.12, i.e. $38,079.59 of real
 * expenses reported as nothing.
 *
 * So the summary row is never trusted on its own. Expenses are worked out from
 * the account rows and cross-checked against Gross Profit − Net Operating
 * Income, and any disagreement is carried out of here rather than resolved
 * silently — a wrong number shown to Cleo as fact is the failure being
 * prevented.
 */
function totalExpenses(report: any): SectionFigure {
  const summary = sectionTotal(report, 'Expenses')
  const detail = sectionDetailSum(report, 'Expenses')
  const gross = sectionTotal(report, 'GrossProfit')
  const noi = sectionTotal(report, 'NetOperatingIncome')
  const derived = gross !== null && noi !== null ? gross - noi : null

  const near = (a: number, b: number) => Math.abs(a - b) < 0.01
  const notes: string[] = []
  if (detail !== null && derived !== null && !near(detail, derived)) {
    notes.push(`itemised expenses ${detail.toFixed(2)} do not match gross profit minus net operating income ${derived.toFixed(2)}`)
  }
  if (summary !== null && detail !== null && !near(summary, detail)) {
    notes.push(`QuickBooks' own "Total Expenses" says ${summary.toFixed(2)} but the line items add up to ${detail.toFixed(2)}`)
  }
  if (summary !== null && detail === null && derived !== null && !near(summary, derived)) {
    notes.push(`QuickBooks' own "Total Expenses" says ${summary.toFixed(2)} but gross profit minus net operating income gives ${derived.toFixed(2)}`)
  }

  // Derived first, deliberately. Gross Profit − Net Operating Income is an
  // identity and was exact against the 12 Sept books to the cent. Summing the
  // account rows is the honest cross-check but is the riskier primary: a
  // report that carries subtotal rows as siblings of their own children
  // double-counts, which is a quieter way to be wrong than the $0 this guard
  // exists to catch. The summary field is the last resort, never the first.
  const pick: SectionFigure =
    derived !== null ? { value: derived, method: 'derived', warning: null }
    : detail !== null ? { value: detail, method: 'detail', warning: null }
    : summary !== null ? { value: summary, method: 'summary', warning: null }
    : { value: 0, method: 'none', warning: 'No expense figure could be read from this report at all.' }

  return { ...pick, warning: notes.length ? notes.join('; ') : pick.warning }
}

/** Income, by the same belt-and-braces route. */
function totalIncome(report: any): SectionFigure {
  const summary = sectionTotal(report, 'Income')
  const detail = sectionDetailSum(report, 'Income')
  const warning =
    summary !== null && detail !== null && Math.abs(summary - detail) >= 0.01
      ? `QuickBooks' own "Total Income" says ${summary.toFixed(2)} but the line items add up to ${detail.toFixed(2)}`
      : null
  if (detail !== null) return { value: detail, method: 'detail', warning }
  if (summary !== null) return { value: summary, method: 'summary', warning }
  return { value: 0, method: 'none', warning: 'No income figure could be read from this report at all.' }
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

  const incomeYtd = totalIncome(plYtd)
  const incomeMtd = totalIncome(plMtd)
  const expenseMtd = totalExpenses(plMtd)

  // Carried out, not logged and forgotten. Anything showing these figures is
  // expected to show the warning beside them.
  const warnings = [
    incomeYtd.warning ? `Income year to date: ${incomeYtd.warning}` : null,
    incomeMtd.warning ? `Income this month: ${incomeMtd.warning}` : null,
    expenseMtd.warning ? `Expenses this month: ${expenseMtd.warning}` : null,
  ].filter((w): w is string => w !== null)

  return {
    asOf: today,
    cashCents: cents(sumType('Bank')),
    arCents: cents(sumType('Accounts Receivable')),
    apCents: cents(sumType('Accounts Payable')),
    revenueYtdCents: cents(incomeYtd.value),
    revenueMtdCents: cents(incomeMtd.value),
    expensesMtdCents: cents(expenseMtd.value),
    methods: { revenueYtd: incomeYtd.method, revenueMtd: incomeMtd.method, expensesMtd: expenseMtd.method },
    warnings,
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
    // methods and warnings ride along with the figures. A number whose
    // provenance is not stored beside it is a number nobody can check later.
    raw: { accounts: p.accounts, methods: p.methods, warnings: p.warnings } as never,
  }
  await db.financialSnapshot.upsert({ where: { forDate }, create: { forDate, ...data }, update: data })
  return p
}
