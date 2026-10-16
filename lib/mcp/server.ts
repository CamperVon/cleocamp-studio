import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import type { PrismaClient } from '@/generated/prisma/client'
import type { LiveStock } from '@/lib/mcp/live-stock'
import { SCOPE, unauthorized, verifyAccess, type Caller } from '@/lib/mcp/oauth'
import { scrub } from '@/lib/mcp/scrub'
import { MCP_TOOLS, MUSE_TOOLS, ToolError, type McpTool, type ToolContext, type Tx } from '@/lib/mcp/tools'
import { museAuthorized, museKey } from '@/lib/muse'

/**
 * The connector's MCP endpoint (/api/mcp), stateless: every request builds
 * its own server and transport, answers in plain JSON (no stream to hold
 * open), and is done, which is what a serverless function wants.
 *
 * Every tool runs inside a transaction set READ ONLY, so Postgres refuses any
 * write a tool might make, whatever its code says. Every answer is scrubbed
 * (lib/mcp/scrub.ts). Every call is logged as tool, time, duration and ok or
 * an error category: never the arguments, never the answer.
 */

type Db = PrismaClient

export const INSTRUCTIONS =
  'Studio Mouse is the internal admin app of Cleo Camp, a small apparel brand in Los Angeles. These tools read its records: products, stock, ' +
  'prices, purchase orders, vendors, open questions, notes and the daily brief. They cannot change anything. Stock is Shopify\'s live count; ' +
  'if Shopify does not answer, the app\'s copy is used and the answer says so (null means unknown, not zero; below zero is pre-orders). Prices are ' +
  'USD unless a purchase order says otherwise. To change something, ask a person to tell ' +
  'Studio Mouse in the app.'

/** One tool call: read-only transaction, scrubbed answer, logged outcome. */
export async function runTool(db: Db, t: McpTool, args: unknown, caller: Pick<Caller, 'clientId' | 'personId'>, ctx: ToolContext = { audience: 'claude' }) {
  const started = Date.now()
  let ok = false
  let errorKind: string | null = null
  try {
    const result = await db.$transaction(async (tx: Tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY')
      return t.run(tx, args as never, ctx)
    }, { timeout: 25_000, maxWait: 10_000 })
    ok = true
    return { content: [{ type: 'text' as const, text: JSON.stringify(scrub(result)) }] }
  } catch (e) {
    errorKind = e instanceof ToolError ? e.kind : 'internal'
    if (!(e instanceof ToolError)) console.error(`[mcp] ${t.name} failed`, e)
    const message = e instanceof ToolError ? e.message : 'Studio Mouse could not answer that just now. Try again, or try another tool.'
    return { isError: true, content: [{ type: 'text' as const, text: message }] }
  } finally {
    // Best effort: a failed log line never costs the answer.
    await db.mcpCall.create({ data: { tool: t.name, ok, errorKind, durationMs: Date.now() - started, clientId: caller.clientId, personId: caller.personId } })
      .catch((e) => console.error('[mcp] could not log the call', e))
  }
}

/** The id Muse's calls are logged under, and its on/off switch (an McpClient row by this id; /connector). */
export const MUSE_CLIENT_ID = 'muse'

export function buildServer(db: Db, caller: Caller, ctx: ToolContext) {
  const server = new McpServer({ name: 'studio-mouse', title: 'Studio Mouse', version: '1.0.0' }, { instructions: INSTRUCTIONS })
  for (const t of MCP_TOOLS) {
    if (ctx.audience === 'muse' && !MUSE_TOOLS.has(t.name)) continue
    server.registerTool(t.name, {
      title: t.title,
      description: t.description,
      inputSchema: t.input,
      annotations: { title: t.title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, (args: unknown) => runTool(db, t, args, caller, ctx))
  }
  return server
}

/**
 * Muse, with the key it already uses for /api/muse (Authorization: Bearer or
 * X-API-Key), while it is switched on: an McpClient row 'muse' exists. No
 * key of 32+ characters set, no row, or a wrong key: not Muse.
 */
async function museCaller(db: Db, req: Request): Promise<Caller | null> {
  if (!museAuthorized(req.headers.get('authorization'), museKey(), req.headers.get('x-api-key'))) return null
  if (!(await db.mcpClient.findUnique({ where: { id: MUSE_CLIENT_ID }, select: { id: true } }))) return null
  return { clientId: MUSE_CLIENT_ID, personId: null, familyId: MUSE_CLIENT_ID, expiresAt: new Date(Date.now() + 3600e3) }
}

/** POST /api/mcp. Anything without a live access token (or Muse's key) gets the 401 that starts sign-in. */
export async function handleMcp(req: Request, deps: { db: Db; origin: string; liveStock?: LiveStock }): Promise<Response> {
  const auth = req.headers.get('authorization')
  const oauth = await verifyAccess(deps.db, auth, deps.origin)
  const caller = oauth ?? await museCaller(deps.db, req)
  if (!caller) return unauthorized(deps.origin, auth ? 'invalid_token' : undefined)
  const server = buildServer(deps.db, caller, { audience: oauth ? 'claude' : 'muse', liveStock: deps.liveStock })
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  await server.connect(transport)
  try {
    return await transport.handleRequest(req, {
      authInfo: { token: 'redacted', clientId: caller.clientId, scopes: [SCOPE], expiresAt: Math.floor(caller.expiresAt.getTime() / 1000) },
    })
  } finally {
    await server.close().catch(() => {})
  }
}
