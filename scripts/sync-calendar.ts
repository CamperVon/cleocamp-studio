import 'dotenv/config'
import { PrismaClient } from '../generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { fetchFeed } from '../lib/integrations/calendar'

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL }) })

async function main() {
  const events = await fetchFeed()
  let n = 0
  for (const e of events) {
    const existing = await db.calendarEvent.findFirst({ where: { googleEventId: e.uid } })
    const data = {
      googleEventId: e.uid,
      title: e.title,
      date: e.start,
      type: 'OTHER' as const,
      source: 'GOOGLE' as const,
      notes: [e.location, e.notes].filter(Boolean).join(' — ') || null,
    }
    if (existing) await db.calendarEvent.update({ where: { id: existing.id }, data })
    else await db.calendarEvent.create({ data })
    n++
  }
  console.log(`calendar: ${n} events synced`)
  const upcoming = await db.calendarEvent.findMany({
    where: { date: { gte: new Date(Date.now() - 864e5) } },
    orderBy: { date: 'asc' }, take: 8,
  })
  for (const u of upcoming) {
    console.log('  ' + u.date.toISOString().slice(0, 10) + '  ' + u.title)
  }
}

main().then(() => db.$disconnect()).catch(async (e) => {
  console.error(e); await db.$disconnect(); process.exit(1)
})
