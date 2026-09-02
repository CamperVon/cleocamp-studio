import { db } from '@/lib/db'

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

export async function processInbox(limit = 20) {
  const unread = await db.inboundEmail.findMany({
    where: { processedAt: null },
    orderBy: { receivedAt: 'asc' },
    take: limit,
  })

  let balancesRecorded = 0
  for (const mail of unread) {
    if (!TRUSTED.test(mail.fromAddress)) continue
    const body = (mail.text ?? mail.html ?? '').slice(0, 6000)
    const found = extractBalances(body)
    if (!found) continue
    await recordBalances(found.accounts, mail.fromAddress, mail.receivedAt)
    await db.inboundEmail.update({ where: { id: mail.id }, data: { processedAt: new Date() } })
    balancesRecorded++
  }

  return { seen: unread.length, balancesRecorded }
}
