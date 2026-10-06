/**
 * Mouse's troubleshooting log, for whoever maintains the code (CLAUDE.md).
 *
 *   npx tsx scripts/troubleshooting.ts             open issues, newest first, plus
 *                                                  "couldn't do" flags and support cases
 *                                                  flagged "Mouse got this wrong"
 *   npx tsx scripts/troubleshooting.ts --all       include fixed ones from the last 14 days
 *   npx tsx scripts/troubleshooting.ts --fixed <id> "what was changed"
 *
 * Read-only unless --fixed is given. Prints no secrets: tool inputs only.
 */
import { db } from '@/lib/db'

const args = process.argv.slice(2)
const day = (d: Date) => d.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

async function main() {
  const fi = args.indexOf('--fixed')
  if (fi >= 0) {
    const id = args[fi + 1]
    const note = args.slice(fi + 2).join(' ').trim()
    if (!id || !note) throw new Error('Usage: --fixed <id> "what was changed"')
    const r = await db.mouseIssue.update({ where: { id }, data: { fixedAt: new Date(), fixNote: note.slice(0, 500) } })
    console.log(`Marked fixed: ${r.id} — ${r.fixNote}`)
    return
  }
  const all = args.includes('--all')
  const [issues, gaps, flagged] = await Promise.all([
    db.mouseIssue.findMany({
      where: all ? { OR: [{ fixedAt: null }, { fixedAt: { gte: new Date(Date.now() - 14 * 864e5) } }] } : { fixedAt: null },
      orderBy: { lastSeenAt: 'desc' },
      take: 100,
    }),
    db.actionItem.findMany({ where: { kind: 'GAP', resolved: false }, orderBy: { createdAt: 'desc' }, select: { id: true, title: true, detail: true, createdAt: true } }),
    db.supportCase.findMany({ where: { reviewRequestedAt: { not: null }, reviewedAt: null }, select: { id: true, reviewReason: true, reviewRequestedBy: true, reviewRequestedAt: true } }),
  ])

  console.log(`# Troubleshooting log — ${issues.filter((i) => !i.fixedAt).length} open\n`)
  for (const i of issues) {
    console.log(`[${i.id}] ${i.fixedAt ? 'FIXED ' : ''}${i.kind}${i.tool ? ` · ${i.tool}` : ''} · ${i.source} · ${day(i.lastSeenAt)}${i.times > 1 ? ` · ×${i.times}` : ''}`)
    console.log(`  ${i.detail.replace(/\n/g, '\n  ')}`)
    if (i.asked) console.log(`  asked: ${i.asked.replace(/\n/g, ' ').slice(0, 300)}`)
    if (i.input) console.log(`  input: ${JSON.stringify(i.input).slice(0, 400)}`)
    if (i.fixNote) console.log(`  fixed: ${i.fixNote}`)
    console.log('')
  }
  console.log(`# Mouse couldn't do (open flags on ToDo) — ${gaps.length}\n`)
  for (const g of gaps) console.log(`[${g.id}] ${day(g.createdAt)} · ${g.title}${g.detail ? `\n  ${g.detail.slice(0, 400).replace(/\n/g, '\n  ')}` : ''}\n`)
  console.log(`# Support cases flagged "Mouse got this wrong" — ${flagged.length}\n`)
  for (const f of flagged) console.log(`[${f.id}] ${f.reviewRequestedAt ? day(f.reviewRequestedAt) : ''} · ${f.reviewRequestedBy ?? ''}: ${f.reviewReason ?? ''}\n`)
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1) })
