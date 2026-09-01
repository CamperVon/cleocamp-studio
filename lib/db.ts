import { PrismaClient } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

// Runtime uses the POOLED connection. Serverless opens a connection per
// invocation, and an unpooled endpoint would exhaust Neon's limit under any
// real load. Migrations use DIRECT_URL instead — see prisma.config.ts.
const makeClient = () =>
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  })

// Next's dev server re-evaluates modules on every change; without this the
// process accumulates clients until Neon refuses new connections.
const g = globalThis as unknown as { prisma?: ReturnType<typeof makeClient> }

export const db = g.prisma ?? makeClient()
if (process.env.NODE_ENV !== 'production') g.prisma = db
