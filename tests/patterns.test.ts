import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/prisma/client'
import { nextPatternCode, PATTERN_RE, patternChoices, resolvePattern, type PatternLite } from '../lib/patterns'
import { CLEO_TEE_PATTERNS, HOLDERS, holderQuestion, planPatternSeed } from '../lib/pattern-seed'
import { lineView } from '../lib/po-snapshot'
import { SKU_RE, STYLE_RE } from '../lib/style-system'
import { renderPoSnapshot, type PoForPdf } from '../lib/po-pdf'

const P = (code: string, status: PatternLite['status'] = 'ACTIVE', fabric: string | null = null): PatternLite => ({ id: code, code, status, fabric })
const TEE = { number: 'TCO101', patterns: [P('TCO101-P1', 'ACTIVE', 'pre-washed'), P('TCO101-P2', 'ACTIVE', 'PFD')] }
const BAG = { number: 'HCB101', patterns: [P('HCB101-P1')] }

test('a TCO101 line cannot go out until P1 or P2 is picked; a one-pattern style defaults to it', () => {
  const stop = resolvePattern({}, TEE, true)
  assert.equal(stop.code, null)
  assert.match(stop.problem!, /TCO101 has 2 patterns in use, TCO101-P1 \(pre-washed fabric\) and TCO101-P2 \(PFD fabric\): pick one/)
  assert.deepEqual(resolvePattern({ pattern: TEE.patterns[1] }, TEE, true), { code: 'TCO101-P2', problem: null })
  assert.deepEqual(resolvePattern({}, BAG, true), { code: 'HCB101-P1', problem: null })
})

test('only cut-and-sew lines default; a style with no pattern on file is not stopped; archived is never used', () => {
  assert.deepEqual(resolvePattern({}, TEE, false), { code: null, problem: null }, 'a fabric or trim order is not cut from a pattern')
  assert.deepEqual(resolvePattern({}, { number: 'ASR101', patterns: [] }, true), { code: null, problem: null })
  assert.deepEqual(resolvePattern({}, null, true), { code: null, problem: null })
  // Off PFD: P2 retiring, P1 the one active pattern, so P1 is the default.
  assert.equal(resolvePattern({}, { number: 'TCO101', patterns: [P('TCO101-P1'), P('TCO101-P2', 'RETIRING')] }, true).code, 'TCO101-P1')
  // A style whose only pattern is on its way out is still cut from it.
  assert.equal(resolvePattern({}, { number: 'X', patterns: [P('X-P1', 'ARCHIVED'), P('X-P2', 'RETIRING')] }, true).code, 'X-P2')
  assert.deepEqual(patternChoices([P('A-P1', 'ARCHIVED')]), [])
  const archived = resolvePattern({ pattern: P('TCO101-P1', 'ARCHIVED') }, TEE, true)
  assert.equal(archived.code, null)
  assert.match(archived.problem!, /archived/)
})

test('pattern codes: STYLE-P#, numbered past the highest ever, never reused', () => {
  assert.equal(nextPatternCode('TCO101', []), 'TCO101-P1')
  assert.equal(nextPatternCode('TCO101', ['TCO101-P1', 'TCO101-P2']), 'TCO101-P3')
  assert.equal(nextPatternCode('TCO101', ['TCO101-P2', 'TCC101-P7']), 'TCO101-P3', 'P1 archived and gone still counts as used; another style\'s codes do not')
  for (const c of ['TCO101-P1', 'HCB101-P12']) assert.ok(PATTERN_RE.test(c), c)
  for (const c of ['TCO101-P0', 'TCO101P1', 'TP101-P1', 'TCO101-BLK-01']) assert.ok(!PATTERN_RE.test(c), c)
})

test('no pattern code is ever a style number or a SKU, and nothing that writes to Shopify knows patterns exist', async () => {
  for (const c of [...CLEO_TEE_PATTERNS.map((p) => p.code), 'HCB101-P1', 'TCO101-P12']) {
    assert.ok(!SKU_RE.test(c), `${c} must not pass as a SKU`)
    assert.ok(!STYLE_RE.test(c), `${c} must not pass as a style number`)
    for (const sku of ['TCO101-BLK-01', 'HCD101-DBL-OS']) assert.ok(!SKU_RE.test(`${sku}-${c}`) && !SKU_RE.test(`${c}-BLK-01`))
  }
  // The Shopify client, the SKU rules and the SKU writer: none of them reads a pattern.
  const shopify = await readFile(new URL('../lib/integrations/shopify.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(shopify, /pattern/i)
  const admin = await readFile(new URL('../lib/style-admin.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(admin, /patterns\b|patternId|Pattern\b/, 'assign_skus never reads a pattern')
  const schema = await readFile(new URL('../prisma/schema.prisma', import.meta.url), 'utf8')
  const variant = schema.match(/model ProductVariant \{[\s\S]*?\n\}/)![0]
  assert.doesNotMatch(variant, /pattern/i, 'a variant has no pattern field')
})

test('the seed: the Cleo Tee\'s two as given, P1 for every style that has been made, holders as Brandon confirmed, the rest asked', () => {
  const at = (d: string) => new Date(`${d}T12:00:00-07:00`)
  const styles = [
    { id: 's1', number: 'TCO101', name: 'Cleo Tee', patternCount: 0, makers: [{ vendor: "Antonio's", at: at('2026-09-16'), ref: 'PO 2360' }] },
    { id: 's2', number: 'HCB101', name: 'Cleo Bag', patternCount: 0, makers: [{ vendor: 'Lorena and Santos', at: at('2026-10-15'), ref: 'PO 2405' }] },
    { id: 's3', number: 'ASR101', name: 'Sardine', patternCount: 0, makers: [] },
    { id: 's4', number: 'BFS101', name: '5to7 Skirt', patternCount: 1, makers: [{ vendor: 'Staples', at: at('2026-09-09'), ref: 'PO 2362' }] },
    { id: 's5', number: 'TCL101', name: 'Long Sleeve Cleo Tee', patternCount: 0, makers: [] },
    { id: 's6', number: 'DXM101', name: 'Christmas Dress', patternCount: 0, makers: [{ vendor: 'Fashion Garcia', at: at('2026-09-01'), ref: 'run started Sep 1' }, { vendor: 'Staples', at: at('2026-10-01'), ref: 'PO 2399' }] },
  ]
  const plan = planPatternSeed(styles)
  assert.deepEqual(plan.problems, [])
  assert.deepEqual(plan.create.map((p) => [p.code, p.fabric, p.heldBy]), [
    ['DXM101-P1', null, null],
    ['HCB101-P1', null, 'Lorena and Santos'],
    ['TCL101-P1', null, 'Staples'],
    ['TCO101-P1', 'pre-washed', 'Pat'],
    ['TCO101-P2', 'PFD', "Empire (Antonio's), Staples"],
  ])
  assert.equal(plan.create.find((p) => p.code === 'HCB101-P1')!.description, 'current pattern')
  assert.deepEqual(plan.skipped, ['BFS101 already has 1 pattern(s)'], 'running it again adds nothing')
  // Only a style nobody has confirmed is asked about, naming the latest maker.
  assert.deepEqual(plan.unknownHolder, [{ number: 'DXM101', name: 'Christmas Dress', likely: 'Staples', ref: 'PO 2399' }])
  assert.match(holderQuestion(plan.unknownHolder).detail, /DXM101-P1 \(Christmas Dress\): probably Staples, PO 2399/)
  assert.equal(HOLDERS['TCC101-P1'], "Empire (Antonio's), Staples", 'a pattern held in two places says both')
  assert.match(planPatternSeed(styles.filter((s) => s.number !== 'TCO101')).problems[0], /re-key/)
})

// The vendor's PDF, drawn by the real renderer.
const pdfText = async (po: PoForPdf, name: string) => {
  const dir = '/tmp/studio-mouse-pdf-qa'
  await mkdir(dir, { recursive: true })
  await writeFile(`${dir}/${name}.pdf`, await renderPoSnapshot(po, { billToLines: 'TEST CO', confirmLine: 'Please confirm.', contactLines: 'Test' }))
  return execFileSync('pdftotext', [`${dir}/${name}.pdf`, '-'], { encoding: 'utf8' })
}
const havePoppler = (() => { try { execFileSync('pdftotext', ['-v'], { stdio: 'pipe' }); return true } catch { return false } })()

const pdfPo = (line: Record<string, unknown>, patterns: PatternLite[], status = 'SENT') => ({
  id: 'fx', poNumber: 'TEST-300', status, language: 'en', orderedAt: new Date('2026-10-01T19:00:00Z'), createdAt: new Date('2026-10-01T19:00:00Z'),
  expectedAt: null, forProduct: null, contactLines: null, deliverTo: null, paymentTerms: null, notes: null,
  vendor: { name: 'Test Maker', role: 'MANUFACTURER', legalName: null, contactName: null, address: null },
  lines: [{
    id: 'l1', component: null, description: null, descriptionAlt: null, qtyOrdered: 10, unit: 'pcs', unitAlt: null, unitCostCents: 1000, pattern: null,
    productVariant: { productId: 'p', sku: 'CCSS25COT-BLK01', newSku: 'TCO101-BLK-01', size: '1', imageUrl: null, colorway: { customerName: 'Black' }, product: { name: 'Cleo Tee', style: { number: 'TCO101', patterns } } },
    ...line,
  }],
}) as unknown as PoForPdf

test('a PO sent before patterns existed prints exactly the same after; one sent with a pattern prints it', { skip: !havePoppler && 'pdftotext not installed' }, async () => {
  const sentBefore = { snapshotAt: new Date('2026-10-01T19:00:00Z'), snapSku: 'TP101-BLK-01 (was CCSS25COT-BLK01)', snapProductName: 'Cleo Tee', snapColorway: 'Black', snapSize: '1', snapImageUrl: null, snapPattern: null }
  const before = await pdfText(pdfPo(sentBefore, []), 'pattern-before')
  const afterSeed = await pdfText(pdfPo(sentBefore, TEE.patterns), 'pattern-after')
  assert.equal(afterSeed, before)
  assert.doesNotMatch(afterSeed, /Pattern|TCO101/)
  assert.match(before, /TP101-BLK-01 \(was CCSS25COT-BLK01\)/)
  const sentWith = await pdfText(pdfPo({ ...sentBefore, snapPattern: 'TCO101-P2' }, TEE.patterns), 'pattern-sent')
  assert.match(sentWith, /Pattern: TCO101-P2/)
  assert.doesNotMatch(sentWith.replace('Pattern: TCO101-P2', ''), /-P\d/, 'the pattern is on its own line, never in the SKU')
})

test('the line view: frozen lines read their saved pattern, drafts work it out, and the label never changes', () => {
  const v = { sku: 'CCSS25COT-BLK01', newSku: 'TCO101-BLK-01', size: '1', imageUrl: null, colorway: { customerName: 'Black' }, product: { name: 'Cleo Tee', style: TEE } }
  assert.equal(lineView({ productVariant: v }, 'new', { cutAndSew: true })!.patternToPick?.includes('pick one'), true)
  assert.equal(lineView({ productVariant: v, pattern: TEE.patterns[0] }, 'new', { cutAndSew: true })!.pattern, 'TCO101-P1')
  assert.equal(lineView({ productVariant: v, snapshotAt: new Date(), snapSku: 'X', snapPattern: null, pattern: TEE.patterns[0] }, 'new', { cutAndSew: true })!.pattern, null, 'sent without one, stays without one')
  assert.equal(lineView({ productVariant: v }, 'new', { cutAndSew: true })!.sku, 'TCO101-BLK-01')
})

// Against a real Postgres: every migration on an in-memory PGlite.
let pg: PGlite
let server: PGLiteSocketServer
let db: PrismaClient

before(async () => {
  pg = new PGlite()
  const root = new URL('../prisma/migrations/', import.meta.url)
  for (const f of (await readdir(root, { withFileTypes: true })).filter((f) => f.isDirectory()).map((f) => f.name).sort()) await pg.exec(await readFile(new URL(`${f}/migration.sql`, root), 'utf8'))
  const port = 50000 + Math.floor(Math.random() * 5000)
  server = new PGLiteSocketServer({ db: pg, port })
  await server.start()
  db = new PrismaClient({ adapter: new PrismaPg({ connectionString: `postgresql://postgres@127.0.0.1:${port}/postgres`, max: 1 }) })

  await db.vendor.createMany({ data: [{ id: 'v_emp', name: 'Empire', role: 'MANUFACTURER' }, { id: 'v_fab', name: 'Fabric Co', role: 'COMPONENT_SUPPLIER' }] })
  await db.style.createMany({ data: [{ id: 's_tee', number: 'TCO101', name: 'Cleo Tee', categoryCode: 'T', status: 'ACTIVE' }, { id: 's_bag', number: 'HCB101', name: 'Cleo Bag', categoryCode: 'H', status: 'ACTIVE' }] })
  await db.pattern.createMany({ data: [
    { id: 'pt1', styleId: 's_tee', code: 'TCO101-P1', description: 'for pre-washed', fabric: 'pre-washed', heldBy: 'Pat' },
    { id: 'pt2', styleId: 's_tee', code: 'TCO101-P2', description: 'for PFD', fabric: 'PFD', heldBy: "Empire (Antonio's)" },
    { id: 'pb1', styleId: 's_bag', code: 'HCB101-P1', description: 'current pattern' },
  ] })
  await db.product.createMany({ data: [{ id: 'pr_tee', name: 'Cleo Tee', status: 'ACTIVE', styleId: 's_tee' }, { id: 'pr_bag', name: 'Cleo Bag', status: 'ACTIVE', styleId: 's_bag' }] })
  await db.productVariant.createMany({ data: [
    { id: 'pv_tee', productId: 'pr_tee', size: '1', sku: 'CCSS25COT-BLK01', newSku: 'TCO101-BLK-01', previousSku: 'TP101-BLK-01' },
    { id: 'pv_bag', productId: 'pr_bag', size: 'OS', newSku: 'HCB101-OLV-OS' },
  ] })
  await db.purchaseOrder.createMany({ data: [
    { id: 'po_tee', poNumber: '9001', vendorId: 'v_emp', status: 'DRAFT' },
    { id: 'po_bag', poNumber: '9002', vendorId: 'v_emp', status: 'DRAFT' },
    { id: 'po_fab', poNumber: '9003', vendorId: 'v_fab', status: 'DRAFT' },
  ] })
  await db.purchaseOrderLine.createMany({ data: [
    { id: 'l_tee', purchaseOrderId: 'po_tee', productVariantId: 'pv_tee', qtyOrdered: 100, unit: 'pcs' },
    { id: 'l_bag', purchaseOrderId: 'po_bag', productVariantId: 'pv_bag', qtyOrdered: 20, unit: 'pcs' },
    { id: 'l_fab', purchaseOrderId: 'po_fab', productVariantId: 'pv_tee', qtyOrdered: 5, unit: 'pcs' },
  ] })
})

after(async () => {
  await db?.$disconnect()
  await server?.stop()
  await pg?.close()
})

test('database: the Cleo Tee order is stopped until a pattern is picked, then goes out with it saved like the SKU', async () => {
  const { patternGate } = await import('../lib/po-patterns')
  const { freezePoLines } = await import('../lib/po-snapshot')
  assert.match((await patternGate('po_tee', db))!, /line 1 \(Cleo Tee \/ 1\): TCO101 has 2 patterns in use.*update_purchase_order_lines \(patternCode\)/)
  await db.purchaseOrderLine.update({ where: { id: 'l_tee' }, data: { patternId: 'pt2' } })
  assert.equal(await patternGate('po_tee', db), null)
  await freezePoLines('po_tee', { client: db })
  const l = await db.purchaseOrderLine.findUniqueOrThrow({ where: { id: 'l_tee' } })
  assert.equal(l.snapPattern, 'TCO101-P2')
  assert.equal(l.snapSku, 'TCO101-BLK-01 (was CCSS25COT-BLK01)', 'the SKU is untouched by the pattern')
  // The variant itself never learns of it.
  const v = await db.productVariant.findUniqueOrThrow({ where: { id: 'pv_tee' } })
  assert.deepEqual([v.sku, v.newSku, v.previousSku, v.shopifySku], ['CCSS25COT-BLK01', 'TCO101-BLK-01', 'TP101-BLK-01', null])
})

test('database: a one-pattern style defaults on send; an order with a non-maker gets no pattern at all', async () => {
  const { patternGate } = await import('../lib/po-patterns')
  const { freezePoLines } = await import('../lib/po-snapshot')
  assert.equal(await patternGate('po_bag', db), null)
  await freezePoLines('po_bag', { client: db })
  assert.equal((await db.purchaseOrderLine.findUniqueOrThrow({ where: { id: 'l_bag' } })).snapPattern, 'HCB101-P1')
  assert.equal(await patternGate('po_fab', db), null)
  await freezePoLines('po_fab', { client: db })
  assert.equal((await db.purchaseOrderLine.findUniqueOrThrow({ where: { id: 'l_fab' } })).snapPattern, null)
})
