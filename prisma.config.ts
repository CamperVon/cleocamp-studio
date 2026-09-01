import 'dotenv/config'
import path from 'node:path'
import { defineConfig } from 'prisma/config'

// Prisma 7 moved connection URLs out of schema.prisma into this file.
//
// Migrations run over DIRECT_URL — the UNPOOLED Neon endpoint. Connection
// pooling breaks DDL, which is the whole reason two connection strings exist.
// The application itself uses the pooled DATABASE_URL at runtime, via the
// driver adapter in lib/db.ts.
export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
  },
  datasource: {
    url: process.env.DIRECT_URL!,
  },
})
