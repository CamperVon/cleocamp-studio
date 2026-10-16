import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TOOLS } from '../lib/mouse/tools'
import {
  inTurn, statesStockLine, codesIn, confirmFromWords, replyBlock, HOLD_MS,
  type ItemTerms, type StockCall, type HeldRow, type Turn, type ConfirmDeps, type GateDeps,
} from '../lib/receipt-gate'
import { ownEmailWords } from '../lib/mouse/team-mail'

// 16 Oct 2026, the shadow bake-off: "PO 2360 arrived in full today." One
// layout logged the White tees at what the PO still owed. Codex's review of
// the first fix: a bare number is not a statement, a later "yes" read by the
// model is not a confirmation, and an unknown person confirms nothing.
//
// The end-to-end tests below run log_inventory_event's real `run` and the
// real confirmation code. Only storage is swapped (ToolContext.stock), since
// the only database is production.

process.env.INVENTORY_WRITES = 'on'

const CLEO_TEE: ItemTerms = {
  kind: 'variant',
  names: ['Cleo Tee', 'TCL101'],
  rivals: ['Cosmo Stripe Tee', 'Long Sleeve Cleo Tee', '5to7 Skirt'],
  colour: { mine: 'White', all: ['White', 'Black', 'Shell', 'Hot Pink'] },
  size: { mine: '1', all: ['1', '2', '3'] },
}
const termsFor = (variantId: string): ItemTerms => {
  const [colour, size] = variantId.split('-').slice(1)
  if (variantId.startsWith('cosmo')) return { ...CLEO_TEE, names: ['Cosmo Stripe Tee'], rivals: ['Cleo Tee', 'Long Sleeve Cleo Tee'], colour: { mine: colour, all: ['White', 'Black'] }, size: { mine: size, all: ['1', '2', '3'] } }
  return { ...CLEO_TEE, colour: { ...CLEO_TEE.colour, mine: colour }, size: { ...CLEO_TEE.size, mine: size } } as ItemTerms
}

/** An in-memory stand-in for PendingReceipt and the ledger. */
function store(now = () => 1_000_000) {
  const rows: HeldRow[] = []
  const writes: Array<Record<string, unknown>> = []
  let n = 0
  const gate: GateDeps = {
    terms: async (c: StockCall) => (c.productVariantId ? termsFor(c.productVariantId) : null),
    label: async (c: StockCall) => `${c.poNumber ? `PO ${c.poNumber} · ` : ''}${c.productVariantId} · ${c.qty} received`,
    hold: async (c: StockCall, label: string, turn: Turn) => {
      const code = ['K7Q2', 'M4XA', 'T9PC'][rows.length] ?? `Z${rows.length}ZZ`
      rows.push({ ...c, id: `h${rows.length}`, code, label, createdAt: new Date(now()), personId: turn.personId, usedAt: null })
      return { id: rows[rows.length - 1].id, code }
    },
  }
  const write = async (i: Record<string, unknown>) => { writes.push(i); return { eventId: `e${++n}`, applied: true } }
  const confirm: ConfirmDeps = {
    findOpen: async (code) => rows.find((r) => r.code === code) ?? null,
    claim: async (id) => { const r = rows.find((x) => x.id === id)!; if (r.usedAt) return false; r.usedAt = new Date(now()); return true },
    release: async (id) => { rows.find((x) => x.id === id)!.usedAt = null },
    markLogged: async () => {},
    // What logConfirmedHeld does in production: the held line, exactly.
    write: async (row) => write({ type: row.type, productVariantId: row.productVariantId, deltaQty: row.qty, purchaseOrderNumber: row.poNumber }),
    now,
  }
  return { rows, writes, ctx: { stock: { gate, write } }, confirm }
}

const run = (s: ReturnType<typeof store>, turn: Turn, input: Record<string, unknown>) =>
  inTurn(turn, () => TOOLS.log_inventory_event.run(input, s.ctx)) as Promise<Record<string, unknown>>

const WHITE_1 = { type: 'RECEIVED', productVariantId: 'cleo-White-1', deltaQty: 510, purchaseOrderNumber: '2360', note: 'PO 2360' }
const brandon = (words: string, id = 't1'): Turn => ({ id, personId: 'brandon', words })

// ── End to end, through log_inventory_event ─────────────────────────────────

test('the bake-off case: "arrived in full" logs nothing and holds the line', async () => {
  const s = store()
  const r = await run(s, brandon('PO 2360 arrived in full today.'), WHITE_1)
  assert.equal(s.writes.length, 0)
  assert.equal(r.applied, false)
  assert.equal(r.held, 'K7Q2')
  assert.match(String(r.error), /cannot log a held line/)
})

test('an unrelated later "yes" does not log the held line', async () => {
  const s = store()
  await run(s, brandon('PO 2360 arrived in full today.'), WHITE_1)
  // The model hears "yes" and tries again: same fields. There is no id it can pass.
  const again = await run(s, brandon('yes', 't2'), WHITE_1)
  assert.equal(again.applied, false)
  const c = await confirmFromWords(brandon('yes', 't2'), s.confirm)
  assert.deepEqual(c, { logged: [], refused: [] })
  assert.equal(s.writes.length, 0)
})

test('a number stated for a different item or PO does not log', async () => {
  for (const words of [
    '510 Cosmo Stripe Tee White size 1 came in on PO 2360', // another product
    'PO 2360: 510 Cleo Tee Black size 1, 85 White size 3', // the 510 is Black
    'PO 2360: Cleo Tee White size 2, 510 of them', // the 510 is size 2
    'Cleo Tee White size 1, 510 came on PO 2378', // another PO
    '510 Cleo Tee White size 1', // no PO named
  ]) {
    const s = store()
    const r = await run(s, brandon(words), WHITE_1)
    assert.equal(s.writes.length, 0, words)
    assert.equal(r.applied, false, words)
  }
})

test('an unknown person: nothing held for them, nothing confirmed by them', async () => {
  const s = store()
  const r = await run(s, { id: 't1', personId: null, words: 'PO 2360 arrived in full today.' }, WHITE_1)
  assert.equal(r.applied, false)
  assert.equal(r.held, undefined)
  assert.equal(s.rows.length, 0)

  // A line held for Brandon cannot be confirmed by an unknown sign-in…
  await run(s, brandon('PO 2360 arrived in full today.'), WHITE_1)
  const c1 = await confirmFromWords({ id: 't2', personId: null, words: 'LOG K7Q2' }, s.confirm)
  assert.equal(c1.logged.length, 0)
  // …and a line held with no person (an old row, say) cannot be confirmed by anyone.
  s.rows[0].personId = null
  const c2 = await confirmFromWords(brandon('LOG K7Q2', 't3'), s.confirm)
  assert.equal(c2.logged.length, 0)
  assert.equal(s.writes.length, 0)
})

test('an explicit, exact confirmation logs that one held line, once', async () => {
  const s = store()
  await run(s, brandon('PO 2360 arrived in full today.'), WHITE_1)
  await run(s, brandon('PO 2360 arrived in full today.'), { ...WHITE_1, productVariantId: 'cleo-White-2', deltaQty: 245 })
  const c = await confirmFromWords(brandon('LOG k7q2', 't2'), s.confirm)
  assert.equal(c.logged.length, 1)
  assert.deepEqual(s.writes, [{ type: 'RECEIVED', productVariantId: 'cleo-White-1', deltaQty: 510, purchaseOrderNumber: '2360' }])
  // The other held line is untouched; the same code again logs nothing.
  assert.equal(s.rows[1].usedAt, null)
  const again = await confirmFromWords(brandon('LOG K7Q2', 't3'), s.confirm)
  assert.equal(again.logged.length, 0)
  assert.match(again.refused[0], /already logged/)
  assert.equal(s.writes.length, 1)
})

test('another person cannot use your code, and a code lapses', async () => {
  let t = 1_000_000
  const s = store(() => t)
  await run(s, brandon('PO 2360 arrived in full today.'), WHITE_1)
  const jane = await confirmFromWords({ id: 't2', personId: 'jane', words: 'LOG K7Q2' }, s.confirm)
  assert.match(jane.refused[0], /someone else/)
  t += HOLD_MS + 1
  const late = await confirmFromWords(brandon('LOG K7Q2', 't3'), s.confirm)
  assert.match(late.refused[0], /lapsed/)
  assert.equal(s.writes.length, 0)
})

test('a direct message naming the exact item, PO and quantity logs normally', async () => {
  for (const words of [
    'PO 2360: 510 Cleo Tee White size 1 came in today',
    'Cleo Tees from PO 2360 came. White: 510 size 1, 245 size 2, 85 size 3',
    'PO 2360 Cleo Tee White size 1: 510',
    'PO 2360 white cleo tees, size 1 x 510',
  ]) {
    const s = store()
    const r = await run(s, brandon(words), WHITE_1)
    assert.equal(s.writes.length, 1, words)
    assert.equal(r.applied, true, words)
  }
})

// ── The pieces ──────────────────────────────────────────────────────────────

test('sizes, dates, times and order numbers are never the quantity', () => {
  const white2 = termsFor('cleo-White-2')
  assert.equal(statesStockLine('Cleo Tee White size 2 arrived 14 Oct, PO 2360', 14, white2, '2360').ok, false)
  assert.equal(statesStockLine('Cleo Tee White size 2 on PO 2360, ready 2pm', 2, white2, '2360').ok, false)
  assert.equal(statesStockLine('PO 2360 Cleo Tee White size 2 for #2794', 2794, white2, '2360').ok, false)
})

test('the longer product name wins: "Long Sleeve Cleo Tee" is not the Cleo Tee', () => {
  assert.equal(statesStockLine('PO 2360: 40 Long Sleeve Cleo Tee White size 1', 40, CLEO_TEE, '2360').ok, false)
})

test('LOG codes are read from the words, in any case', () => {
  assert.deepEqual(codesIn('ok LOG k7q2 and log-M4XA please'), ['K7Q2', 'M4XA'])
  assert.deepEqual(codesIn('yes, log it'), [])
})

test("a code in quoted mail is not the sender's", () => {
  const body = 'Thanks.\n\nOn Thu, Oct 16, 2026 at 9:00 AM Studio Mouse <mouse@send.cleocamp.com> wrote:\n> To log exactly this, reply LOG K7Q2'
  assert.deepEqual(codesIn(ownEmailWords(body)), [])
})

test('the reply block names each held line with its code', () => {
  const b = replyBlock([{ label: 'PO 2360 · Cleo Tee / White / 1 · 510 received', code: 'K7Q2' }], { logged: [], refused: [] })
  assert.match(b, /^Not logged yet\./)
  assert.match(b, /reply LOG K7Q2/)
  assert.equal(replyBlock([], { logged: [], refused: [] }), '')
})

test('a component and its number named together, and no other component beside it', () => {
  const H: ItemTerms = { kind: 'component', names: ['Black leather (Cleo Bag)'], rivals: ['Black leather (Bean Bag)', 'Silver leather (Cleo Bag)'] }
  assert.equal(statesStockLine('50 sq ft of black leather, cleo bag', 50, H, null).ok, true)
  assert.equal(statesStockLine('50 black leather for the cleo bag and bean bag', 50, H, null).ok, false)
  assert.equal(statesStockLine('2 sq ft black leather for the cleo bag', 50, H, null).ok, false)
})
