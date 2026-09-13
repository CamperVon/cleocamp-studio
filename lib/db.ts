import { PrismaClient } from '@/generated/prisma/client'
import { PrismaNeon } from '@prisma/adapter-neon'

// Runtime uses the POOLED connection. Serverless opens a connection per
// invocation, and an unpooled endpoint would exhaust Neon's limit under any
// real load. Migrations use DIRECT_URL instead — see prisma.config.ts.
//
// Neon's own driver, not node-postgres: it reaches Neon over HTTPS/WebSocket
// instead of a raw TCP socket, which is what actually lets this run from a
// Claude Code cloud session — those only have an HTTP(S)-only egress path.
// Confirmed to still support interactive transactions ($transaction with an
// async callback), which lib/mouse/tools.ts relies on for the same-event
// onHandQty write (CLAUDE.md §3). scripts/audit-sight.ts talks to Postgres
// directly via `pg` for an unrelated reason and is untouched by this.
const makeClient = () =>
  new PrismaClient({
    adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }),
  })

// Next's dev server re-evaluates modules on every change; without this the
// process accumulates clients until Neon refuses new connections.
const g = globalThis as unknown as { prisma?: ReturnType<typeof makeClient> }

export const db = g.prisma ?? makeClient()
if (process.env.NODE_ENV !== 'production') g.prisma = db
