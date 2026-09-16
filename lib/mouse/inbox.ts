import { db } from '@/lib/db'
import { htmlToText } from '@/lib/html-to-text'

/**
 * Structured intake only.
 *
 * The nightly balances report from the scheduled routine is data, not
 * correspondence, so it is recorded here directly. Everything else is left
 * unread for the nightly pass, which reasons about it with the whole picture in
 * view rather than one message at a time.
 *
 * Only accepted from a company address. Anyone can post to these mailboxes and
 * a fabricated cash figure would sit on the Finances page looking
 * authoritative, so the sender is checked and the source stored with the
 * figures.
 */
const TRUSTED = /@(send\.)?cleocamp\.com$/i

function extractBalances(text: string): {
  accounts: Array<{ name: string; type?: string; balance: number }>
} | null {
  const block = /\{[\s\S]*\}/.exec(text)
  if (!block) return null
  try {
    const j = JSON.parse(block[0]) as any
    const raw = j.accounts ?? j.balances ?? j.bankAccounts
    if (!Array.isArray(raw) || !raw.length) return null
    const accounts = raw
      .map((a: any) => {
        const name = String(a.name ?? a.account ?? '').trim()
        // Types arrive however the sender wrote them — "credit_card",
        // "Credit Card", or nothing. Normalise rather than match exactly.
        const rawType = String(a.type ?? '').toLowerCase().replace(/[^a-z]/g, '')
        const isCard = rawType.includes('credit') || /credit/i.test(name)
        return {
          name,
          type: isCard ? 'Credit Card' : 'Bank',
          balance: Number(a.balance ?? a.amount ?? a.value),
        }
      })
      .filter((a: any) => a.name && Number.isFinite(a.balance))
    return accounts.length ? { accounts } : null
  } catch {
    return null
  }
}

async function recordBalances(
  accounts: Array<{ name: string; type?: string; balance: number }>,
  from: string,
  when: Date,
) {
  // Sum every bank account, overdrafts included — dropping negatives would
  // overstate the position, and an overdrawn account is what you want to see.
  const cash = accounts
    .filter((a) => (a.type ?? 'Bank') === 'Bank')
    .reduce((n, a) => n + a.balance, 0)
  const card = Math.abs(
    accounts.filter((a) => a.type === 'Credit Card').reduce((n, a) => n + a.balance, 0),
  )
  const forDate = new Date(when.toISOString().slice(0, 10) + 'T00:00:00Z')
  const c = (n: number) => BigInt(Math.round(n * 100))
  const data = {
    cashCents: c(cash),
    apCents: c(card),
    raw: { source: `nightly balances email from ${from}`, accounts } as never,
  }
  await db.financialSnapshot.upsert({ where: { forDate }, create: { forDate, ...data }, update: data })
  await db.alert.updateMany({
    where: { dedupeKey: { in: ['finance:stale', 'finance:none'] }, resolved: false },
    data: { resolved: true, resolvedAt: new Date() },
  })
  return { cash, card }
}

/**
 * Machine senders that post a standing REPORT rather than correspondence. Two
 * of these for the same subject on the same day are a repeat of one fact, not
 * two facts, so only the newest is left for the nightly pass to reason about.
 *
 * Kept to an explicit list on purpose. A person who emails twice under one
 * subject is having a conversation, and dropping the earlier half of it would
 * lose real content.
 */
const MACHINE_REPORTERS = [/^quickbooks@(send\.)?cleocamp\.com$/i]

/**
 * On 15 Sept 2026 two QuickBooks pulls arrived twelve hours apart, both titled
 * "QuickBooks figures — 15 September 2026". Both were correct; the books had
 * moved between them. But the nightly pass reads all unread mail at once, so it
 * met them as two rival claims about one day and opened Mouse's Corner asking
 * which to believe. Nobody needed to arbitrate: the later one simply supersedes
 * the earlier.
 *
 * The rows are kept and marked read, not deleted — the earlier figures are
 * still a true record of what the books said at that hour.
 */
async function supersedeRepeatReports(): Promise<number> {
  const unread = await db.inboundEmail.findMany({
    where: { processedAt: null },
    orderBy: { receivedAt: 'desc' },
  })
  const laDay = (d: Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(d)

  const seen = new Set<string>()
  const superseded: string[] = []
  for (const m of unread) {
    if (!MACHINE_REPORTERS.some((re) => re.test(m.fromAddress))) continue
    const key = `${m.fromAddress.toLowerCase()}|${(m.subject ?? '').trim().toLowerCase()}|${laDay(m.receivedAt)}`
    if (seen.has(key)) superseded.push(m.id)
    else seen.add(key)
  }
  if (!superseded.length) return 0
  await db.inboundEmail.updateMany({
    where: { id: { in: superseded } },
    data: { processedAt: new Date() },
  })
  return superseded.length
}

export async function processInbox(limit = 20) {
  // Before anything reads the mail: collapse repeat reports to the newest.
  const supersededReports = await supersedeRepeatReports()

  const unread = await db.inboundEmail.findMany({
    where: { processedAt: null },
    orderBy: { receivedAt: 'asc' },
    take: limit,
  })

  let balancesRecorded = 0
  for (const mail of unread) {
    if (!TRUSTED.test(mail.fromAddress)) continue
    // A structured-figure email with no plain-text part (rare, but the same
    // gap that left forwards empty — see lib/html-to-text.ts) would otherwise
    // hand raw markup to a regex expecting numbers next to dollar signs.
    const body = (mail.text?.trim() || (mail.html ? htmlToText(mail.html) : '')).slice(0, 6000)
    const found = extractBalances(body)
    if (!found) continue
    await recordBalances(found.accounts, mail.fromAddress, mail.receivedAt)
    await db.inboundEmail.update({ where: { id: mail.id }, data: { processedAt: new Date() } })
    balancesRecorded++
  }

  return { seen: unread.length, balancesRecorded, supersededReports }
}
