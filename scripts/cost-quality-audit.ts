/**
 * Cost-and-quality audit of Mouse's model use (8 Oct 2026). Read-only: it
 * reads ModelUsage and chat replies and prints a report; it writes nothing
 * and calls no model.
 *
 *   npx tsx scripts/cost-quality-audit.ts [--since 2026-10-08T19:00:00Z] [--days 3] [--email-days 7]
 *
 * --since starts the window (default: the first chat reply whose catalogue
 * carried the Phase 2B index); --days sets the length of the baseline window
 * that ends where the main one starts; --email-days sets how far back the
 * email look-up table reaches. Costs are list prices per million tokens; the
 * Anthropic Console's daily total is the billing truth.
 */
import { db } from '@/lib/db'

// $ per million tokens: input, output, 5-minute cache write, 1-hour cache write, cache read.
// From platform.claude.com/docs/en/about-claude/pricing, read 8 Oct 2026. Cache
// reads on these two are 0.05x input, not the usual 0.1x: Sonnet's is $0.10.
export const PRICES: Record<string, { in: number; out: number; w5: number; w1h: number; read: number }> = {
  'claude-opus-5-5': { in: 4, out: 20, w5: 5, w1h: 8, read: 0.2 },
  'claude-sonnet-5-5': { in: 2, out: 10, w5: 2.5, w1h: 4, read: 0.1 },
}
type Req = { model: string; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; cacheWrite1hTokens: number; durationMs?: number | null }
export function costOf(r: Req): number | null {
  const p = PRICES[r.model]
  if (!p) return null
  // cacheWriteTokens is every cache write; the 1-hour ones are a subset of it.
  const w1h = r.cacheWrite1hTokens ?? 0
  const w5 = Math.max(0, (r.cacheWriteTokens ?? 0) - w1h)
  return (r.inputTokens * p.in + r.outputTokens * p.out + w5 * p.w5 + w1h * p.w1h + r.cacheReadTokens * p.read) / 1e6
}

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined }
const median = (xs: number[]) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
const pct = (xs: number[], q: number) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))] }
const usd = (n: number) => `$${n.toFixed(2)}`
const laDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(d)

type Usage = { route?: { lane?: string; reason?: string; escalated?: boolean; escalatedBecause?: string; model?: string }; requests?: Req[]; durationMs?: number; stopReason?: string; providerError?: string | null; context?: { sections?: Array<{ heading: string; bytes: number }> } }

async function main() {
  // When Phase 2B went live: the first chat reply carrying the index-sized Products section.
  const recent = await db.chatMessage.findMany({
    where: { role: 'ASSISTANT', createdAt: { gte: new Date(Date.now() - 14 * 864e5) } },
    orderBy: { createdAt: 'asc' }, select: { createdAt: true, agentUsageJson: true },
  })
  const productsBytes = (u: Usage | null) => u?.context?.sections?.find((s) => s.heading === 'Products')?.bytes ?? null
  const firstIndexed = recent.find((m) => { const b = productsBytes(m.agentUsageJson as Usage); return b !== null && b < 25_000 })
  const since = arg('--since') ? new Date(arg('--since')!) : firstIndexed?.createdAt ?? new Date(Date.now() - 864e5)
  const days = Number(arg('--days') ?? 3)
  const baseFrom = new Date(since.getTime() - days * 864e5)
  const until = new Date()
  const hours = (until.getTime() - since.getTime()) / 36e5
  console.log(`# Mouse cost-and-quality audit\n`)
  console.log(`Window: ${since.toISOString()} → ${until.toISOString()} (${hours.toFixed(1)} h). Baseline: the ${days} days before it.`)
  console.log(`Phase 2B index first seen in a chat reply: ${firstIndexed ? firstIndexed.createdAt.toISOString() : 'NOT SEEN (switch off, or no chat since deploy)'}`)
  const after = recent.filter((m) => m.createdAt >= since)
  const sizes = after.map((m) => productsBytes(m.agentUsageJson as Usage)).filter((b): b is number => b !== null)
  console.log(`Chat replies since then with the index (Products < 25,000 bytes): ${sizes.filter((b) => b < 25_000).length} of ${sizes.length} that recorded a catalogue.\n`)

  // 1. Cost and tokens by source and model, window vs baseline, per hour so different lengths compare.
  for (const [label, from, to] of [['Window', since, until], ['Baseline', baseFrom, since]] as const) {
    const rows = await db.modelUsage.findMany({ where: { createdAt: { gte: from, lt: to } } })
    const h = (to.getTime() - from.getTime()) / 36e5
    const by = new Map<string, { n: number; cost: number; inT: number; outT: number; rd: number; w5: number; w1h: number }>()
    let total = 0
    for (const r of rows) {
      const k = `${r.source} · ${r.model}`
      const c = costOf(r as unknown as Req) ?? 0
      total += c
      const e = by.get(k) ?? { n: 0, cost: 0, inT: 0, outT: 0, rd: 0, w5: 0, w1h: 0 }
      e.n++; e.cost += c; e.inT += r.inputTokens; e.outT += r.outputTokens; e.rd += r.cacheReadTokens
      e.w5 += Math.max(0, r.cacheWriteTokens - (r.cacheWrite1hTokens ?? 0)); e.w1h += r.cacheWrite1hTokens ?? 0
      by.set(k, e)
    }
    console.log(`## ${label}: cost by source and model (list prices) — ${usd(total)} over ${h.toFixed(1)} h = ${usd((total / h) * 24)}/day`)
    console.log('| source · model | requests | cost | $/day | input | output | cache read | write 5m | write 1h |')
    console.log('|---|---|---|---|---|---|---|---|---|')
    for (const [k, e] of [...by.entries()].sort((a, b) => b[1].cost - a[1].cost)) {
      console.log(`| ${k} | ${e.n} | ${usd(e.cost)} | ${usd((e.cost / h) * 24)} | ${e.inT.toLocaleString()} | ${e.outT.toLocaleString()} | ${e.rd.toLocaleString()} | ${e.w5.toLocaleString()} | ${e.w1h.toLocaleString()} |`)
    }
    // Per Los Angeles day, to set beside the Console.
    const perDay = new Map<string, number>()
    for (const r of rows) perDay.set(laDay(r.createdAt), (perDay.get(laDay(r.createdAt)) ?? 0) + (costOf(r as unknown as Req) ?? 0))
    console.log(`\nApp-recorded cost per LA day (compare with the Console): ${[...perDay.entries()].sort().map(([d, c]) => `${d} ${usd(c)}`).join(' · ')}\n`)
  }

  // 2–4. Chat replies in the window: lanes, escalations, failures, rounds, latency, open_record.
  const replies = await db.chatMessage.findMany({
    where: { role: 'ASSISTANT', createdAt: { gte: since }, agentUsageJson: { not: null as never } },
    orderBy: { createdAt: 'asc' }, select: { threadId: true, agentUsageJson: true, toolCallsJson: true },
  })
  const threads = new Set(replies.map((r) => r.threadId))
  const lanes = new Map<string, number>(), reasons = new Map<string, number>(), esc = new Map<string, number>(), stops = new Map<string, number>()
  const reqs: number[] = [], lat: number[] = [], cost: number[] = [], opens: number[] = []
  let readAttempts = 0, readStood = 0, readEscalated = 0, providerErrors = 0
  for (const r of replies) {
    const u = r.agentUsageJson as Usage
    const lane = u.route?.lane ?? 'unrouted'
    lanes.set(lane, (lanes.get(lane) ?? 0) + 1)
    if (u.route?.reason) reasons.set(u.route.reason, (reasons.get(u.route.reason) ?? 0) + 1)
    if (lane === 'read') {
      readAttempts++
      if (u.route?.escalated) { readEscalated++; esc.set(u.route.escalatedBecause ?? '?', (esc.get(u.route.escalatedBecause ?? '?') ?? 0) + 1) } else readStood++
    }
    stops.set(u.stopReason ?? '?', (stops.get(u.stopReason ?? '?') ?? 0) + 1)
    if (u.providerError) providerErrors++
    reqs.push(u.requests?.length ?? 0)
    lat.push(u.durationMs ?? (u.requests ?? []).reduce((n, q) => n + (q.durationMs ?? 0), 0))
    cost.push((u.requests ?? []).reduce((n, q) => n + (costOf(q) ?? 0), 0))
    const calls = Array.isArray(r.toolCallsJson) ? (r.toolCallsJson as Array<{ name?: string }>) : []
    opens.push(calls.filter((c) => c.name === 'open_record').length)
  }
  console.log(`## Chat replies in the window: ${replies.length} across ${threads.size} thread${threads.size === 1 ? '' : 's'}`)
  console.log(`- Lanes: ${[...lanes.entries()].map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`)
  console.log(`- Read lane: ${readAttempts} attempted, ${readStood} answered on Sonnet, ${readEscalated} handed to Opus${esc.size ? ` (${[...esc.entries()].map(([k, v]) => `${k} ${v}`).join(', ')})` : ''}`)
  console.log(`- Stop reasons: ${[...stops.entries()].map(([k, v]) => `${k} ${v}`).join(', ')}; provider errors: ${providerErrors}`)
  console.log(`- Requests per reply: median ${median(reqs)}, p90 ${pct(reqs, 0.9)}, max ${Math.max(0, ...reqs)}`)
  console.log(`- Latency per reply: median ${(median(lat) / 1000).toFixed(1)} s, p90 ${(pct(lat, 0.9) / 1000).toFixed(1)} s`)
  console.log(`- Cost per reply: median ${usd(median(cost))}, mean ${usd(cost.reduce((a, b) => a + b, 0) / Math.max(1, cost.length))}, total ${usd(cost.reduce((a, b) => a + b, 0))}`)
  const withOpen = opens.filter((n) => n > 0).length
  console.log(`- open_record: ${opens.reduce((a, b) => a + b, 0)} calls in ${withOpen} of ${replies.length} replies; replies with one: median ${median(reqs.filter((_, i) => opens[i] > 0))} requests vs ${median(reqs.filter((_, i) => opens[i] === 0))} without (it can share a round with other tool calls, so this is a comparison, not a cost per call)`)
  console.log(`- Top routing reasons: ${[...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ${v}`).join(', ')}`)

  // Prefetch: not stored per reply, so reconstructed from the person's messages against today's records.
  const asked = await db.chatMessage.findMany({ where: { role: 'USER', createdAt: { gte: since } }, select: { content: true } })
  const { prefetchForMessage } = await import('@/lib/mouse/records')
  let hits = 0, full = 0, held = 0
  for (const m of asked) {
    const p = await prefetchForMessage(m.content, { catalogue: true })
    if (!p) continue
    hits++
    full += (p.match(/\), complete$/gm) ?? []).length
    held += (p.match(/was not looked up here/g) ?? []).length
  }
  console.log(`- Prefetch (reconstructed against today's records, not stored at the time): ${hits} of ${asked.length} messages named a record exactly; ${full} records sent whole, ${held} held back past the limit`)
  await emailLookups(Number(arg('--email-days') ?? 7))
  console.log(`\nConsole: the Anthropic Console's daily total is the billing truth; set it beside the app-recorded per-day figures above.`)
}

/**
 * Every request of every chat reply that used query_status what:"email", with
 * the raw token counts the API reported. A tool call is not stamped with the
 * request that made it, so the table shows what arrived: the prompt's growth
 * since the previous request is that request's output plus the tool results
 * it got back. A drop in the prompt means a second pass (the record-it or
 * stock check) that starts again from the conversation without them.
 * The stored tool result is cut for the record (8,000 characters a string,
 * 100 items a list), so its length is not what Mouse read: the email result is
 * rebuilt here from the same query bounded at the reply's time.
 */
async function emailLookups(days: number) {
  const from = new Date(Date.now() - days * 864e5)
  const replies = await db.chatMessage.findMany({
    where: { role: 'ASSISTANT', createdAt: { gte: from } },
    orderBy: { createdAt: 'asc' }, select: { threadId: true, createdAt: true, agentUsageJson: true, toolCallsJson: true },
  })
  const laTime = (d: Date) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(d)
  console.log(`\n## Chat replies that used the email look-up (query_status what:"email"), last ${days} days`)
  let n = 0, all = 0, replayed = 0
  for (const r of replies) {
    const calls = Array.isArray(r.toolCallsJson) ? (r.toolCallsJson as Array<{ name?: string; input?: { what?: string; days?: number; since?: string }; result?: unknown }>) : []
    if (!calls.some((c) => c.name === 'query_status' && c.input?.what === 'email')) continue
    n++
    const u = r.agentUsageJson as Usage
    const reqs = u.requests ?? []
    console.log(`\n### ${laTime(r.createdAt)} (LA), thread …${r.threadId.slice(-6)}, ${reqs.length} requests`)
    console.log('Tool calls, in order (characters: the stored copy, cut for the record; email: rebuilt in full):')
    for (const c of calls) {
      const stored = JSON.stringify(c.result ?? null).length
      if (c.name === 'query_status' && c.input?.what === 'email') {
        const since = c.input.since && /^\d{4}-\d{2}-\d{2}$/.test(c.input.since) ? new Date(`${c.input.since}T00:00:00Z`) : new Date(r.createdAt.getTime() - (c.input.days ?? 56) * 864e5)
        // The tool's own query, ending when the reply was saved.
        const rows = await db.inboundEmail.findMany({
          where: { receivedAt: { gte: since, lte: r.createdAt }, NOT: { toAddress: { contains: 'support@' } } },
          orderBy: { receivedAt: 'desc' }, take: 20,
          select: { id: true, fromAddress: true, toAddress: true, subject: true, text: true, receivedAt: true },
        })
        const full = JSON.stringify(rows).length
        const biggest = Math.max(0, ...rows.map((m) => m.text?.length ?? 0))
        console.log(`- query_status email (${c.input.since ? `since ${c.input.since}` : `${c.input.days ?? 56} days`}): ${rows.length} emails, ${full.toLocaleString()} characters in full (stored copy ${stored.toLocaleString()}); longest body ${biggest.toLocaleString()} characters`)
      } else console.log(`- ${c.name}${c.name === 'query_status' && c.input?.what ? ` ${c.input.what}` : ''}: ${stored.toLocaleString()} characters`)
    }
    console.log('| request | pass | model | uncached input | cache read | cache write 5m | cache write 1h | output | prompt total | prompt growth since previous | cost |')
    console.log('|---|---|---|---|---|---|---|---|---|---|---|')
    let pass = 1, prev = 0, turnCost = 0, after = 0, big = false
    reqs.forEach((q, i) => {
      const total = q.inputTokens + q.cacheReadTokens + q.cacheWriteTokens
      if (i > 0 && total < prev) { pass++; big = false }
      const grew = i > 0 && total >= prev ? total - prev : null
      if (grew !== null && grew > 20_000) big = true
      const c = costOf(q) ?? 0
      turnCost += c
      if (big) after += q.inputTokens
      const w1h = q.cacheWrite1hTokens ?? 0
      console.log(`| ${i + 1} | ${pass} | ${q.model.replace('claude-', '')} | ${q.inputTokens.toLocaleString()} | ${q.cacheReadTokens.toLocaleString()} | ${Math.max(0, q.cacheWriteTokens - w1h).toLocaleString()} | ${w1h.toLocaleString()} | ${q.outputTokens.toLocaleString()} | ${total.toLocaleString()} | ${grew === null ? (i ? 'new pass' : '–') : `+${grew.toLocaleString()}${grew > 20_000 ? ' ← large result arrived' : ''}`} | ${usd(c)} |`)
      prev = total
    })
    const inRate = PRICES[reqs[0]?.model ?? '']?.in ?? 0
    console.log(`Reply cost ${usd(turnCost)}. Uncached input from the request a large result arrived in to the end of that pass: ${after.toLocaleString()} tokens, ${usd((after * inRate) / 1e6)} at the input rate.`)
    all += turnCost; replayed += (after * inRate) / 1e6
  }
  console.log(`\n${n} replies; ${usd(all)} in all, of which ${usd(replayed)} was uncached input carried after a large result arrived.`)
}

// Run only when invoked directly, so costOf can be imported by other scripts.
if (process.argv[1]?.endsWith('cost-quality-audit.ts')) main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1) })
