import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/prisma/client'
import { checkAuthorize, issueCode, OAuthError, registerClient, tokenRequest, verifyAccess, type AuthorizeParams } from '../lib/mcp/oauth'
import { scrubText } from '../lib/mcp/scrub'
import { LIVE_STOCK_QUERY } from '../lib/mcp/live-stock'
import { ALL_TOOLS, handleMcp, MUSE_CLIENT_ID, runTool } from '../lib/mcp/server'
import { MCP_TOOLS, MUSE_TOOLS } from '../lib/mcp/tools'

/**
 * The Claude connector against a real Postgres: every migration applied to an
 * in-memory PGlite, reached by Prisma through a local socket. It never reads
 * DATABASE_URL and never touches the real database.
 */

const ORIGIN = 'https://admin.example.test'
const CALLBACK = 'https://claude.ai/api/mcp/auth_callback'
let pg: PGlite
let server: PGLiteSocketServer
let db: PrismaClient

// What must never come out of any tool.
const SECRETS = ['orders@vendor-example.com', 'jane.doe@gmail.com', '555-0199', '555-0123', '4111 1111 1111 1111', '123456789012', '021000021', 'sk-ant-api03-abcdefghijklmnop', '123 Main St', 'Wire to account', 'brandon@cleocamp.com']

before(async () => {
  pg = new PGlite()
  const root = new URL('../prisma/migrations/', import.meta.url)
  for (const f of (await readdir(root, { withFileTypes: true })).filter((f) => f.isDirectory()).map((f) => f.name).sort()) await pg.exec(await readFile(new URL(`${f}/migration.sql`, root), 'utf8'))
  const port = 55000 + Math.floor(Math.random() * 5000)
  server = new PGLiteSocketServer({ db: pg, port })
  await server.start()
  db = new PrismaClient({ adapter: new PrismaPg({ connectionString: `postgresql://postgres@127.0.0.1:${port}/postgres`, max: 1 }) })

  await db.person.create({ data: { id: 'p_cleo', name: 'Cleo' } })
  await db.vendor.create({ data: { id: 'v_emp', name: 'Empire Sewing', role: 'MANUFACTURER', leadTimeDays: 21, orderMethod: 'email', paymentTerms: 'Net 30', email: 'orders@vendor-example.com', contactInfo: '(213) 555-0199', address: '123 Main St, Los Angeles', notes: 'Wire to account 123456789012, routing 021000021' } })
  await db.vendor.create({ data: { id: 'v_old', name: 'Old Buttons Co', active: false } })
  await db.component.create({ data: { id: 'c_btn', name: 'Shell button 15mm', category: 'TRIM', vendorId: 'v_emp', unitOfMeasure: 'pcs', unitCostCents: 12, leadTimeDays: 14 } })
  await db.styleCode.createMany({ data: [
    { type: 'CATEGORY', code: 'TP', name: 'Tops' }, { type: 'CATEGORY', code: 'DR', name: 'Dresses' },
    { type: 'COLOR', code: 'BLK', name: 'Black' }, { type: 'COLOR', code: 'SHL', name: 'Shell', status: 'PROPOSED' },
    { type: 'SIZE', code: '01', name: 'Size 1' },
  ] })
  await db.style.createMany({ data: [{ id: 's_tp101', number: 'TP101', name: 'Cleo Tee', categoryCode: 'TP', status: 'ACTIVE' }, { id: 's_tp104', number: 'TP104', name: 'Other', categoryCode: 'TP', status: 'RETIRED' }] })
  await db.product.create({ data: { id: 'pr_tee', name: 'Cleo Tee', status: 'ACTIVE', styleId: 's_tp101', retailPriceCents: 12800, wholesalePriceCents: 5600, productionLeadTimeDays: 30 } })
  await db.colorway.create({ data: { id: 'cw_blk', productId: 'pr_tee', customerName: 'Black', colorCode: 'BLK' } })
  await db.productVariant.createMany({ data: [
    { id: 'pv_1', productId: 'pr_tee', colorwayId: 'cw_blk', size: '1', sku: 'CCSS26TEE-BLK01', newSku: 'TP101-BLK-01', shopifySku: 'TEE-BLK-1', shopifyVariantId: '111', onHandQty: 7 },
    { id: 'pv_2', productId: 'pr_tee', colorwayId: 'cw_blk', size: '2', newSku: 'TP101-BLK-02', onHandQty: null, wholesalePriceCents: 6000 },
  ] })
  await db.product.create({ data: { id: 'pr_bag', name: 'Bean Bag', status: 'ACTIVE', retailPriceCents: 39800 } })
  await db.product.create({ data: { id: 'pr_dev', name: 'Story Dress', status: 'DEVELOPMENT' } })
  await db.bomLine.create({ data: { parentProductId: 'pr_tee', componentId: 'c_btn', qtyPerUnit: 3, size: '2' } })
  await db.purchaseOrder.create({ data: { id: 'po_1', poNumber: '2403', vendorId: 'v_emp', status: 'SENT', orderedAt: new Date('2026-10-01T00:00:00Z'), notes: 'Please rush.', contactLines: 'Call 213-555-0199' } })
  await db.purchaseOrderLine.createMany({ data: [
    { purchaseOrderId: 'po_1', productVariantId: 'pv_1', qtyOrdered: 10, unit: 'pcs', unitCostCents: 2500, snapshotAt: new Date('2026-10-01T18:00:00Z'), snapSku: 'TP101-BLK-01', snapStyleNumber: 'TP101', snapProductName: 'Cleo Tee', snapColorway: 'Black', snapSize: '1' },
    { purchaseOrderId: 'po_1', componentId: 'c_btn', qtyOrdered: 100, unit: 'pcs', unitCostCents: null },
  ] })
  await db.purchaseOrder.create({ data: { id: 'po_2', poNumber: '2410', vendorId: 'v_old', status: 'DRAFT' } })
  await db.actionItem.createMany({ data: [
    { kind: 'QUESTION', title: 'Wholesale price for the Bean Bag?', entityType: 'PRODUCT', entityId: 'pr_bag', source: 'EMAIL', detail: 'Asked by jane.doe@gmail.com' },
    { kind: 'TODO', title: 'Count buttons at Empire', entityType: 'VENDOR', entityId: 'v_emp', dueDate: new Date('2026-10-20T00:00:00Z'), urgent: true },
    { kind: 'TODO', title: 'Done already', resolved: true },
  ] })
  await db.note.createMany({ data: [
    { entityType: 'PRODUCT', entityId: 'pr_tee', content: 'Cleo Tee lining is black cotton.' },
    { entityType: 'PRODUCT', entityId: 'pr_tee', content: 'Cleo Tee lining is white.', supersededAt: new Date('2026-10-02T00:00:00Z') },
    { content: 'Customer jane.doe@gmail.com called 310-555-0123, card 4111 1111 1111 1111, key sk-ant-api03-abcdefghijklmnop.' },
  ] })
  await db.dailyBrief.createMany({ data: [
    { forDate: new Date('2026-10-15T00:00:00Z'), text: 'Old brief.' },
    { forDate: new Date('2026-10-16T00:00:00Z'), text: 'Today: PO 2403 is due. Reply to brandon@cleocamp.com.' },
  ] })
})

after(async () => {
  await db?.$disconnect()
  await server?.stop()
  await pg?.close()
})

const caller = { clientId: 'test-client', personId: null }
async function call(name: string, args: Record<string, unknown> = {}) {
  const t = MCP_TOOLS.find((x) => x.name === name)!
  const r = await runTool(db, t, args, caller)
  return { r, data: r.isError ? null : JSON.parse(r.content[0].text) }
}

// ---- every tool, against seeded records ----

test('list_products: styles, colourways, sizes, SKUs, stock (unknown stays null) and prices', async () => {
  const { data } = await call('list_products', { status: 'ACTIVE' })
  assert.equal(data.count, 2)
  const tee = data.products.find((p: { name: string }) => p.name === 'Cleo Tee')
  assert.deepEqual([tee.styleNumber, tee.category, tee.wholesale, tee.retail, tee.colorways, tee.sizes, tee.onHandTotal, tee.onHandUnknownVariants], ['TP101', 'TP', 56, 128, ['Black'], ['1', '2'], 7, 1])
  assert.deepEqual(tee.variants[0], { colorway: 'Black', size: '1', newSku: 'TP101-BLK-01', oldSku: 'CCSS26TEE-BLK01', shopifySku: 'TEE-BLK-1', onHand: 7, wholesale: 56, retail: 128 })
  assert.equal(tee.variants[1].onHand, null)
  assert.equal(tee.variants[1].wholesale, 60, 'a variant\'s own wholesale price wins')
  assert.equal((await call('list_products', { category: 'tp' })).data.count, 1)
  assert.equal((await call('list_products', { styleNumber: 'TP999' })).data.count, 0)
})

test('get_product: by style number, SKU or name, with BOM and current notes only', async () => {
  for (const q of ['TP101', 'tp101-blk-02', 'CCSS26TEE-BLK01', 'cleo tee']) {
    const { data } = await call('get_product', { query: q })
    assert.equal(data.name, 'Cleo Tee', q)
  }
  const { data } = await call('get_product', { query: 'TP101' })
  assert.deepEqual(data.bom, [{ component: 'Shell button 15mm', category: 'TRIM', qtyPerUnit: 3, unit: 'pcs', onlyFor: 'size 2', supplier: 'Empire Sewing', unitCost: 0.12, leadTimeDays: 14 }])
  assert.deepEqual(data.notes.map((n: { text: string }) => n.text), ['Cleo Tee lining is black cotton.'])
  assert.equal(data.productionLeadTimeDays, 30)
  const missing = await call('get_product', { query: 'Nothing like it' })
  assert.equal(missing.r.isError, true)
})

test('get_product: a loose name with several matches comes back to choose from', async () => {
  await db.product.create({ data: { id: 'pr_tee2', name: 'Cleo Tee Long', status: 'DEVELOPMENT' } })
  try {
    const { data } = await call('get_product', { query: 'Tee' })
    assert.equal(data.ambiguous, true)
    assert.deepEqual(data.matches.map((m: { name: string }) => m.name), ['Cleo Tee', 'Cleo Tee Long'])
  } finally { await db.product.delete({ where: { id: 'pr_tee2' } }) }
})

test('wholesale_price_list: as the Wholesale page, "not set" flagged, wholesale as % of retail', async () => {
  const { data } = await call('wholesale_price_list')
  assert.equal(data.products, 2)
  assert.equal(data.notSet, 1)
  const bag = data.rows.find((r: { name: string }) => r.name === 'Bean Bag')
  assert.deepEqual([bag.wholesale, bag.retail, bag.wholesalePctOfRetail], ['not set', 398, null])
  const tee = data.rows.find((r: { name: string }) => r.name === 'Cleo Tee')
  assert.deepEqual([tee.wholesale, tee.retail, tee.wholesalePctOfRetail], [56, 128, 44])
  assert.deepEqual(tee.variants, [{ variant: 'Black / 2', wholesale: 60, retail: 128, wholesalePctOfRetail: 47 }])
  assert.ok(!data.rows.some((r: { name: string }) => r.name === 'Story Dress'), 'not active, no retail price: not on the list')
})

test('list_purchase_orders: totals, filters and paging', async () => {
  const { data } = await call('list_purchase_orders')
  assert.deepEqual([data.total, data.page, data.hasMore], [2, 1, false])
  const po = data.items.find((p: { poNumber: string }) => p.poNumber === '2403')
  assert.deepEqual([po.vendor, po.status, po.ordered, po.total, po.totalIncomplete, po.lines], ['Empire Sewing', 'SENT', '2026-10-01', 250, true, 2])
  assert.equal((await call('list_purchase_orders', { status: 'DRAFT' })).data.total, 1)
  assert.equal((await call('list_purchase_orders', { vendor: 'empire' })).data.total, 1)
  assert.deepEqual((await call('list_purchase_orders', { from: '2026-10-01', to: '2026-10-01' })).data.items.map((p: { poNumber: string }) => p.poNumber), ['2403'])
  assert.equal((await call('list_purchase_orders', { from: '2026-09-01', to: '2026-09-30' })).data.total, 0)
})

test('get_purchase_order: lines as sent (the snapshot), amounts, notes to the vendor', async () => {
  const { data } = await call('get_purchase_order', { poNumber: 'PO 2403' })
  assert.equal(data.notesToVendor, 'Please rush.')
  assert.deepEqual(data.lines[0], { item: 'Cleo Tee', sku: 'TP101-BLK-01', styleNumber: 'TP101', colorway: 'Black', size: '1', asSent: '2026-10-01', ordered: 10, received: 0, unit: 'pcs', unitCost: 25, amount: 250 })
  assert.deepEqual([data.lines[1].item, data.lines[1].unitCost, data.lines[1].amount], ['Shell button 15mm', null, null])
  assert.equal((await call('get_purchase_order', { poNumber: '9999' })).r.isError, true)
})

test('list_open_questions: open only, what each is about, email ones marked as proposals', async () => {
  const { data } = await call('list_open_questions')
  assert.equal(data.total, 2)
  assert.deepEqual(data.items.map((i: { title: string }) => i.title), ['Count buttons at Empire', 'Wholesale price for the Bean Bag?'])
  assert.deepEqual(data.items[0].about, { type: 'vendor', name: 'Empire Sewing' })
  assert.equal(data.items[0].due, '2026-10-20')
  assert.equal(data.items[1].from, 'email (a proposal to confirm)')
  assert.equal((await call('list_open_questions', { kind: 'QUESTION' })).data.total, 1)
})

test('search_notes: current by default, superseded on request, with what it is about', async () => {
  const { data } = await call('search_notes', { query: 'lining' })
  assert.deepEqual(data.items.map((n: { text: string; status: string }) => [n.text, n.status]), [['Cleo Tee lining is black cotton.', 'current']])
  assert.deepEqual(data.items[0].about, { type: 'product', name: 'Cleo Tee' })
  const all = await call('search_notes', { query: 'lining', includeSuperseded: true })
  assert.equal(all.data.total, 2)
  assert.match(all.data.items.find((n: { text: string }) => n.text.includes('white')).status, /^superseded/)
})

test('get_latest_snapshot: the newest daily brief', async () => {
  const { data } = await call('get_latest_snapshot')
  assert.equal(data.forDate, '2026-10-16')
  assert.match(data.brief, /PO 2403 is due/)
})

test('list_vendors: what they supply and lead times, active only by default, no contact or bank details', async () => {
  const { data } = await call('list_vendors')
  assert.equal(data.count, 1)
  assert.deepEqual(data.vendors[0], { name: 'Empire Sewing', legalName: null, role: 'MANUFACTURER', active: true, leadTimeDays: 21, orderMethod: 'email', paymentTerms: 'Net 30', supplies: [{ component: 'Shell button 15mm', category: 'TRIM', leadTimeDays: 14 }], purchaseOrders: 1, productionRuns: 0 })
  assert.equal((await call('list_vendors', { includeInactive: true })).data.count, 2)
})

test('style_system: categories with the next free number (retired ones count), colours and sizes', async () => {
  const { data } = await call('style_system')
  assert.deepEqual(data.categories, [{ code: 'DR', name: 'Dresses', status: 'CONFIRMED', styles: 0, nextStyleNumber: 'DR101' }, { code: 'TP', name: 'Tops', status: 'CONFIRMED', styles: 2, nextStyleNumber: 'TP105' }])
  assert.deepEqual(data.colors.map((c: { code: string; status: string }) => [c.code, c.status]), [['BLK', 'CONFIRMED'], ['SHL', 'PROPOSED']])
  assert.deepEqual(data.sizes, [{ code: '01', name: 'Size 1', status: 'CONFIRMED' }])
})

// ---- read-only, and nothing sensitive comes out ----

async function fingerprint(skip: string[]) {
  const tables = (await pg.query<{ t: string }>(`SELECT table_name AS t FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1`)).rows.map((r) => r.t).filter((t) => !skip.includes(t))
  const out: Record<string, string> = {}
  for (const t of tables) out[t] = (await pg.query<{ h: string }>(`SELECT md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) AS h FROM "${t}" x`)).rows[0].h
  return out
}

const EVERY_CALL: Array<[string, Record<string, unknown>]> = [
  ['list_products', {}], ['get_product', { query: 'TP101' }], ['wholesale_price_list', {}], ['list_purchase_orders', {}],
  ['get_purchase_order', { poNumber: '2403' }], ['list_open_questions', {}], ['search_notes', {}], ['search_notes', { includeSuperseded: true }],
  ['get_latest_snapshot', {}], ['list_vendors', { includeInactive: true }], ['style_system', {}],
]

test('no tool writes: every table but the call log is unchanged after calling all of them', async () => {
  const before = await fingerprint(['McpCall'])
  const calls = (await pg.query<{ n: number }>('SELECT count(*)::int AS n FROM "McpCall"')).rows[0].n
  for (const [name, args] of EVERY_CALL) assert.ok(!(await call(name, args)).r.isError, name)
  assert.deepEqual(await fingerprint(['McpCall']), before)
  assert.equal((await pg.query<{ n: number }>('SELECT count(*)::int AS n FROM "McpCall"')).rows[0].n, calls + EVERY_CALL.length, 'one log row per call')
})

test('the database refuses a write from inside a tool', async () => {
  const sneaky = { ...MCP_TOOLS[0], name: 'sneaky', run: async (tx: Parameters<typeof MCP_TOOLS[0]['run']>[0]) => tx.vendor.update({ where: { id: 'v_emp' }, data: { name: 'Hacked' } }) }
  const r = await runTool(db, sneaky, {}, caller)
  assert.equal(r.isError, true)
  assert.equal((await db.vendor.findUniqueOrThrow({ where: { id: 'v_emp' } })).name, 'Empire Sewing')
  const log = await db.mcpCall.findFirstOrThrow({ where: { tool: 'sneaky' } })
  assert.deepEqual([log.ok, log.errorKind], [false, 'internal'])
})

test('no key, token, bank or card number, phone or email ever leaves a tool', async () => {
  const text = (await Promise.all(EVERY_CALL.map(([n, a]) => call(n, a)))).map((c) => c.r.content[0].text).join('\n')
  for (const s of SECRETS) assert.ok(!text.includes(s), `leaked: ${s}`)
  assert.match(text, /\[removed: email\]/)
  assert.match(text, /\[removed: key\]/)
})

test('the scrubber leaves ordinary values alone, invoice and tracking numbers included', () => {
  for (const s of ['TP101-BLK-01', '2026-10-16', 'PO 2403', '$1,234.56', 'CCSS26COT-SHL01', 'Net 30', '58-60" wide, 220 gsm', 'U-Line invoice #48213377', 'Invoice 20261003: style 03639009S', 'USPS 9400111899223197428490', 'Shopify order 6123456789012']) assert.equal(scrubText(s), s)
})

test('the scrubber removes cards, bank details, keys, emails and phones', () => {
  assert.equal(scrubText('card 4111-1111-1111-1111'), 'card [removed: card]')
  assert.equal(scrubText('Wire to account 123456789012, routing 021000021'), 'Wire to account [removed: bank details], routing [removed: bank details]')
  assert.equal(scrubText('IBAN GB29 NWBK 6016 1331 9268 19'), 'IBAN [removed: bank details]')
  assert.equal(scrubText('call (213) 555-0199 or +44 20 7946 0958'), 'call [removed: phone] or [removed: phone]')
  assert.equal(scrubText('key shpat_0123456789abcdef'), 'key [removed: key]')
})

test('the call log holds no arguments or answers', async () => {
  const cols = Object.keys(await db.mcpCall.findFirstOrThrow())
  assert.deepEqual(cols.sort(), ['clientId', 'createdAt', 'durationMs', 'errorKind', 'id', 'ok', 'personId', 'tool'])
})

// ---- OAuth: registration, consent, tokens, and the endpoint's door ----

const verifier = 'v'.repeat(20) + 'erifier-for-the-test-0123456789abcdef'
const challenge = createHash('sha256').update(verifier).digest('base64url')
const params = (clientId: string, o: Partial<AuthorizeParams> = {}): AuthorizeParams => ({ response_type: 'code', client_id: clientId, redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: 'S256', state: 'xyz', scope: 'mouse.read', resource: `${ORIGIN}/api/mcp`, ...o })
const form = (o: Record<string, string>) => new URLSearchParams(o)

async function connect() {
  const c = await registerClient(db, { client_name: 'Claude', redirect_uris: [CALLBACK], token_endpoint_auth_method: 'none' })
  assert.equal((await checkAuthorize(db, params(c.client_id), ORIGIN)).ok, true)
  const code = await issueCode(db, params(c.client_id), ORIGIN, 'p_cleo')
  const t = await tokenRequest(db, form({ grant_type: 'authorization_code', client_id: c.client_id, code, code_verifier: verifier, redirect_uri: CALLBACK, resource: `${ORIGIN}/api/mcp` }), null, ORIGIN)
  return { client: c, code, ...t }
}

const rpc = (body: unknown, token?: string) => new Request(`${ORIGIN}/api/mcp`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
})

test('registration accepts only Claude\'s own callback', async () => {
  await assert.rejects(registerClient(db, { redirect_uris: ['https://evil.example/cb'] }), (e) => e instanceof OAuthError && e.code === 'invalid_redirect_uri')
  await assert.rejects(registerClient(db, { redirect_uris: [] }), OAuthError)
  await assert.rejects(registerClient(db, { redirect_uris: [CALLBACK], grant_types: ['client_credentials'] }), OAuthError)
})

test('consent checks: unknown client, another redirect, no PKCE, another resource', async () => {
  const c = await registerClient(db, { redirect_uris: [CALLBACK] })
  assert.equal((await checkAuthorize(db, params('nope'), ORIGIN)).ok, false)
  assert.equal((await checkAuthorize(db, params(c.client_id, { redirect_uri: 'https://claude.com/api/mcp/auth_callback' }), ORIGIN)).ok, false, 'not the one it registered')
  assert.equal((await checkAuthorize(db, params(c.client_id, { code_challenge: null }), ORIGIN)).ok, false)
  assert.equal((await checkAuthorize(db, params(c.client_id, { code_challenge_method: 'plain' }), ORIGIN)).ok, false)
  assert.equal((await checkAuthorize(db, params(c.client_id, { resource: 'https://other.example/api/mcp' }), ORIGIN)).ok, false)
})

test('every tool rejects a call with no token, a made-up token, an expired or revoked one', async () => {
  const list = { jsonrpc: '2.0', id: 1, method: 'tools/list' }
  const none = await handleMcp(rpc(list), { db, origin: ORIGIN })
  assert.equal(none.status, 401)
  assert.match(none.headers.get('www-authenticate') ?? '', /resource_metadata="https:\/\/admin\.example\.test\/\.well-known\/oauth-protected-resource"/)
  for (const t of MCP_TOOLS) {
    const r = await handleMcp(rpc({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: t.name, arguments: {} } }), { db, origin: ORIGIN })
    assert.equal(r.status, 401, t.name)
    const bogus = await handleMcp(rpc({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: t.name, arguments: {} } }, 'x'.repeat(43)), { db, origin: ORIGIN })
    assert.equal(bogus.status, 401, t.name)
  }
  const { access_token, client } = await connect()
  await db.mcpGrant.updateMany({ where: { tokenHash: createHash('sha256').update(access_token).digest('hex') }, data: { expiresAt: new Date(Date.now() - 1000) } })
  assert.equal((await handleMcp(rpc(list, access_token), { db, origin: ORIGIN })).status, 401, 'expired')
  const fresh = await connect()
  await db.mcpGrant.updateMany({ where: { clientId: fresh.client.client_id }, data: { revokedAt: new Date() } })
  assert.equal((await handleMcp(rpc(list, fresh.access_token), { db, origin: ORIGIN })).status, 401, 'revoked')
  assert.equal(await verifyAccess(db, `Bearer ${(await connect()).access_token}`, 'https://another-host.example'), null, 'a token is only good for the endpoint it was issued for')
  void client
})

test('end to end: register, approve, exchange with PKCE, then list and call tools over MCP', async () => {
  const { access_token, refresh_token, expires_in } = await connect()
  assert.equal(expires_in, 3600)
  assert.ok(refresh_token)
  const init = await handleMcp(rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }, access_token), { db, origin: ORIGIN })
  assert.equal(init.status, 200)
  const listed = await (await handleMcp(rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, access_token), { db, origin: ORIGIN })).json()
  const tools = listed.result.tools as Array<{ name: string; annotations: { readOnlyHint: boolean } }>
  assert.deepEqual(tools.map((t) => t.name).sort(), ALL_TOOLS.map((t) => t.name).sort())
  assert.ok(tools.filter((t) => !['tell_mouse', 'tell_claude_code'].includes(t.name)).every((t) => t.annotations.readOnlyHint === true))
  assert.ok(tools.filter((t) => ['tell_mouse', 'tell_claude_code'].includes(t.name)).every((t) => t.annotations.readOnlyHint === false), 'the two that write say so')
  const called = await (await handleMcp(rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_purchase_order', arguments: { poNumber: '2403' } } }, access_token), { db, origin: ORIGIN })).json()
  assert.equal(JSON.parse(called.result.content[0].text).vendor, 'Empire Sewing')
  const bad = await (await handleMcp(rpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'list_purchase_orders', arguments: { from: 'last week' } } }, access_token), { db, origin: ORIGIN })).json()
  assert.ok(bad.result?.isError || bad.error, 'bad input is refused, not run')
})

test('PKCE, single-use codes and rotating refresh tokens', async () => {
  const c = await registerClient(db, { redirect_uris: [CALLBACK] })
  const code = await issueCode(db, params(c.client_id), ORIGIN, null)
  const exchange = (v: string) => tokenRequest(db, form({ grant_type: 'authorization_code', client_id: c.client_id, code, code_verifier: v, redirect_uri: CALLBACK }), null, ORIGIN)
  await assert.rejects(exchange('w'.repeat(50)), (e) => e instanceof OAuthError && e.code === 'invalid_grant')
  await assert.rejects(exchange(verifier), OAuthError, 'a code is spent by its first use, even a failed one')

  const ok = await connect()
  await assert.rejects(tokenRequest(db, form({ grant_type: 'authorization_code', client_id: ok.client.client_id, code: ok.code, code_verifier: verifier, redirect_uri: CALLBACK }), null, ORIGIN), OAuthError, 'replayed code')
  assert.equal(await verifyAccess(db, `Bearer ${ok.access_token}`, ORIGIN), null, 'a replayed code revokes what it issued')

  const live = await connect()
  const next = await tokenRequest(db, form({ grant_type: 'refresh_token', client_id: live.client.client_id, refresh_token: live.refresh_token }), null, ORIGIN)
  assert.ok(await verifyAccess(db, `Bearer ${next.access_token}`, ORIGIN))
  await assert.rejects(tokenRequest(db, form({ grant_type: 'refresh_token', client_id: live.client.client_id, refresh_token: live.refresh_token }), null, ORIGIN), OAuthError, 'refresh tokens rotate')
  assert.equal(await verifyAccess(db, `Bearer ${next.access_token}`, ORIGIN), null, 'reusing a spent refresh token revokes the family')
})

test('a client registered with a secret must present it', async () => {
  const c = await registerClient(db, { redirect_uris: [CALLBACK], token_endpoint_auth_method: 'client_secret_post' })
  assert.ok(c.client_secret)
  const code = await issueCode(db, params(c.client_id), ORIGIN, null)
  await assert.rejects(tokenRequest(db, form({ grant_type: 'authorization_code', client_id: c.client_id, code, code_verifier: verifier, redirect_uri: CALLBACK }), null, ORIGIN), (e) => e instanceof OAuthError && e.code === 'invalid_client')
  const code2 = await issueCode(db, params(c.client_id), ORIGIN, null)
  const basic = `Basic ${Buffer.from(`${c.client_id}:${c.client_secret}`).toString('base64')}`
  const t = await tokenRequest(db, form({ grant_type: 'authorization_code', code: code2, code_verifier: verifier, redirect_uri: CALLBACK }), basic, ORIGIN)
  assert.ok(t.access_token)
})

test('tokens are stored only as hashes', async () => {
  const { access_token, refresh_token } = await connect()
  const raw = (await pg.query<{ s: string }>(`SELECT string_agg(x::text, '|') AS s FROM "McpGrant" x`)).rows[0].s
  assert.ok(!raw.includes(access_token) && !raw.includes(refresh_token))
})

// ---- live stock from Shopify (Brandon, 16 Oct 2026) ----

test('stock is Shopify\'s live count when Shopify answers, asked only for variants on Shopify', async () => {
  const asked: string[][] = []
  const liveStock = async (ids: string[]) => { asked.push(ids); return new Map([['111', 3]]) }
  const t = MCP_TOOLS.find((x) => x.name === 'list_products')!
  const data = JSON.parse((await runTool(db, t, { styleNumber: 'TP101' }, caller, { audience: 'claude', liveStock })).content[0].text)
  assert.deepEqual(asked, [['111']])
  assert.equal(data.stock.source, 'Shopify, live')
  const [v1, v2] = data.products[0].variants
  assert.deepEqual([v1.onHand, v1.stockFrom], [3, undefined], 'Shopify\'s 3, not the app\'s 7')
  assert.deepEqual([v2.onHand, v2.stockFrom], [null, 'app (not on Shopify)'])
  assert.equal(data.products[0].onHandTotal, 3)
  const one = JSON.parse((await runTool(db, MCP_TOOLS.find((x) => x.name === 'get_product')!, { query: 'TP101' }, caller, { audience: 'claude', liveStock })).content[0].text)
  assert.equal(one.variants[0].onHand, 3)
})

test('when Shopify does not answer, the app\'s copy is used and the answer says so', async () => {
  const liveStock = async () => { throw new Error('Shopify took too long') }
  const t = MCP_TOOLS.find((x) => x.name === 'list_products')!
  const r = await runTool(db, t, { styleNumber: 'TP101' }, caller, { audience: 'claude', liveStock })
  assert.equal(r.isError, undefined)
  const data = JSON.parse(r.content[0].text)
  assert.match(data.stock.source, /did not answer/)
  // Said once, at the top, rather than on every variant.
  assert.deepEqual([data.products[0].variants[0].onHand, data.products[0].variants[0].stockFrom], [7, undefined])
})

test('the live stock request to Shopify is a read, never a mutation', () => {
  assert.match(LIVE_STOCK_QUERY, /^query\b/)
  assert.doesNotMatch(LIVE_STOCK_QUERY, /mutation|Set|Adjust|update|delete|create/i)
})

// ---- Muse, with its own key, on a narrower set of tools ----

const MUSE_KEY = 'muse-test-key-' + 'x'.repeat(40)
const museRpc = (body: unknown, headers: Record<string, string>) => new Request(`${ORIGIN}/api/mcp`, {
  method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers }, body: JSON.stringify(body),
})

test('Muse connects with its own key only while switched on, and sees no notes, questions or brief', async () => {
  const before = process.env.MUSE_API_KEY
  process.env.MUSE_API_KEY = MUSE_KEY
  try {
    const list = { jsonrpc: '2.0', id: 1, method: 'tools/list' }
    assert.equal((await handleMcp(museRpc(list, { authorization: `Bearer ${MUSE_KEY}` }), { db, origin: ORIGIN })).status, 401, 'switched off: no row')
    await db.mcpClient.create({ data: { id: MUSE_CLIENT_ID, name: 'Muse', redirectUris: [], tokenEndpointAuthMethod: 'muse-key' } })
    assert.equal((await handleMcp(museRpc(list, { authorization: 'Bearer wrong-key-' + 'y'.repeat(40) }), { db, origin: ORIGIN })).status, 401, 'wrong key')
    const listed = await (await handleMcp(museRpc(list, { authorization: `Bearer ${MUSE_KEY}` }), { db, origin: ORIGIN })).json()
    assert.deepEqual(listed.result.tools.map((t: { name: string }) => t.name).sort(), [...MUSE_TOOLS].sort())
    for (const hidden of ['search_notes', 'list_open_questions', 'get_latest_snapshot']) assert.ok(!MUSE_TOOLS.has(hidden), hidden)
    const notes = await (await handleMcp(museRpc({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'search_notes', arguments: {} } }, { 'x-api-key': MUSE_KEY }), { db, origin: ORIGIN })).json()
    assert.ok(notes.error || notes.result?.isError, 'a tool Muse does not have cannot be called')
    const product = await (await handleMcp(museRpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_product', arguments: { query: 'TP101' } } }, { 'x-api-key': MUSE_KEY }), { db, origin: ORIGIN })).json()
    const p = JSON.parse(product.result.content[0].text)
    assert.equal(p.name, 'Cleo Tee')
    assert.equal(p.notes, undefined, 'no team notes for Muse')
    assert.ok(await db.mcpCall.findFirst({ where: { clientId: MUSE_CLIENT_ID, tool: 'get_product' } }), 'Muse\'s calls are logged as Muse')
    // A new registration's clean-up never removes Muse's switch.
    await db.mcpClient.update({ where: { id: MUSE_CLIENT_ID }, data: { createdAt: new Date(Date.now() - 7 * 864e5) } })
    await registerClient(db, { redirect_uris: [CALLBACK] })
    assert.ok(await db.mcpClient.findUnique({ where: { id: MUSE_CLIENT_ID } }))
    await db.mcpClient.delete({ where: { id: MUSE_CLIENT_ID } })
    assert.equal((await handleMcp(museRpc(list, { authorization: `Bearer ${MUSE_KEY}` }), { db, origin: ORIGIN })).status, 401, 'switched off again')
  } finally {
    if (before === undefined) delete process.env.MUSE_API_KEY
    else process.env.MUSE_API_KEY = before
  }
})

// ---- passing something on: tell_mouse and tell_claude_code (Brandon, 16 Oct 2026) ----

const tellMouse = ALL_TOOLS.find((t) => t.name === 'tell_mouse')!
const tellClaudeCode = ALL_TOOLS.find((t) => t.name === 'tell_claude_code')!

test('tell_mouse goes straight to Mouse as the person who connected, and both sides are kept', async () => {
  const seen: Array<{ said: string; personId: string }> = []
  const runMouse = async (_thread: string, said: string, personId: string) => { seen.push({ said, personId }); return { text: 'Noted: 12 Black size 1 received against PO 2403.', writes: ['log_inventory_event'], toolCalls: [{ name: 'log_inventory_event' }] } }
  const r = await runTool(db, tellMouse, { message: '12 Black size 1 tees arrived on PO 2403' }, { clientId: 'c', personId: 'p_cleo' }, { audience: 'claude', personId: 'p_cleo', runMouse })
  assert.equal(r.isError, undefined)
  assert.deepEqual(seen, [{ said: '[Cleo, via a Claude chat] 12 Black size 1 tees arrived on PO 2403', personId: 'p_cleo' }])
  assert.equal(JSON.parse(r.content[0].text).mouseReplied, 'Noted: 12 Black size 1 received against PO 2403.')
  const kept = await db.chatMessage.findMany({ where: { thread: { title: 'From Claude' } }, orderBy: { createdAt: 'asc' }, select: { role: true, content: true } })
  assert.deepEqual(kept.slice(-2).map((m) => m.role), ['USER', 'ASSISTANT'])
  assert.equal(kept.at(-2)!.content, '12 Black size 1 tees arrived on PO 2403', 'the person\'s words, as the app chat shows them')
})

test('tell_mouse refuses without a named person, and Mouse is never run', async () => {
  let ran = false
  const runMouse = async () => { ran = true; return { text: 'x', toolCalls: [] } }
  const before = await db.chatMessage.count()
  const r = await runTool(db, tellMouse, { message: 'anything' }, { clientId: 'c', personId: null }, { audience: 'claude', personId: null, runMouse })
  assert.equal(r.isError, true)
  assert.match(r.content[0].text, /who is speaking/)
  assert.equal(ran, false)
  assert.equal(await db.chatMessage.count(), before)
})

test('tell_claude_code leaves a request in the troubleshooting log and touches nothing else', async () => {
  const r = await runTool(db, tellClaudeCode, { request: 'Show the wholesale price on the Products page too.' }, { clientId: 'c', personId: 'p_cleo' }, { audience: 'claude', personId: 'p_cleo' })
  const out = JSON.parse(r.content[0].text)
  const row = await db.mouseIssue.findUniqueOrThrow({ where: { id: out.reference } })
  assert.deepEqual([row.kind, row.source, row.tool, row.detail, row.asked, row.fixedAt], ['REQUEST', 'claude-chat', 'tell_claude_code', 'Show the wholesale price on the Products page too.', 'From Cleo, via a Claude chat', null])
})

test('Muse never gets the tools that pass something on', () => {
  for (const t of ['tell_mouse', 'tell_claude_code']) assert.ok(!MUSE_TOOLS.has(t), t)
})
