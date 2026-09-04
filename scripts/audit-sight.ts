/**
 * Does Studio Mouse's context cover everything in the schema?
 *
 * It was blind to its own production runs, notes, forecasts, calendar entries
 * and alerts — it could write all of them and read none back, which read as
 * stupidity but was a missing query. This makes that a check rather than
 * something noticed after it embarrasses itself.
 *
 * Run it after adding any model. Tables that genuinely do not belong in the
 * catalogue are listed in EXPECTED_ABSENT with the reason.
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { Client } from 'pg'

const EXPECTED_ABSENT: Record<string, string> = {
  ChatMessage: 'the conversation itself is passed as history',
  ChatThread: 'ditto',
  ChatAttachment: 'attached to the message being read',
  InventoryEvent: 'reachable on demand via query_status',
  InboundEmail: 'reachable on demand via query_status, and read by the nightly pass',
  DigestSend: 'bookkeeping for the cron, not something to reason about',
  SentEmail: 'a record of what already went out, not something to reason about',
  StorageCleanup: 'bookkeeping for the cron, not something to reason about',
  DailyBrief: "its own writing; including it would be a hall of mirrors",
  QuickBooksConnection: 'credentials, never in a prompt',
  Location: 'one location; surfaces through components and variants',
  FileLink: 'navigation for the humans, not facts about the business',
  ProductionRunLine: 'included with its run',
  ProductionRunCost: 'included with its run',
  PurchaseOrderLine: 'included with its order',
  WholesaleShipment: 'included with its account',
  WholesaleShipmentLine: 'included with its shipment',
  BomLine: 'included with its product',
  Colorway: 'included with its product',
  ProductVariant: 'included with its product',
}

async function main() {
  const ctx = readFileSync('lib/mouse/context.ts', 'utf8')
  const c = new Client({ connectionString: process.env.DIRECT_URL })
  await c.connect()
  const t = await c.query(
    "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1",
  )

  const blind: string[] = []
  for (const r of t.rows) {
    const n = r.table_name as string
    if (n.startsWith('_')) continue
    const prop = n.charAt(0).toLowerCase() + n.slice(1)
    const seen = ctx.includes(`db.${prop}.`) || ctx.includes(`${prop}: true`)
    if (!seen && !(n in EXPECTED_ABSENT)) blind.push(n)
  }
  await c.end()

  if (blind.length) {
    console.error('Studio Mouse cannot see these tables:\n' + blind.map((b) => '  - ' + b).join('\n'))
    console.error('\nAdd them to buildCatalog, or to EXPECTED_ABSENT with a reason.')
    process.exit(1)
  }
  console.log('Studio Mouse can see everything it should.')
}

main()
