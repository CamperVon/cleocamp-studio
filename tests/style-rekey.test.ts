import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lineLabel, lineView } from '../lib/po-snapshot'
import { mentionedRecords } from '../lib/mouse/notes'
import { MERGES, planRekey, REKEY, rekeyedNotes, swapCodes, type SnapStyle, type SnapVariant } from '../lib/style-rekey'
import { CATEGORIES, OLD_STYLE_RE, STYLE_RE } from '../lib/style-system'

test('the table: every new number passes the format, is used once, starts with its category, and no old one comes back', () => {
  const tos = REKEY.flatMap((r) => (r.to ? [r.to] : []))
  assert.equal(new Set(tos).size, tos.length, 'each new number once')
  for (const t of tos) {
    assert.ok(STYLE_RE.test(t), t)
    assert.ok(CATEGORIES.some((c) => c.code === t[0] && !c.reserved), `${t}: a category in use`)
  }
  for (const r of REKEY) if (r.from) assert.ok(OLD_STYLE_RE.test(r.from), r.from)
  assert.deepEqual(REKEY.filter((r) => r.from === 'BG101').map((r) => r.to), ['HCB101', 'HCD101'], 'the Cleo Bag splits, Denim on its own')
  assert.deepEqual(REKEY.find((r) => r.from === 'DR106')?.to, null, 'Dolce loses its number')
  assert.equal(REKEY.find((r) => r.to === 'TCW101')?.from, null, "Cleo Tee Wilde's is new")
})

// A database that looks like ours, built from the table itself.
function snapshot(): { styles: SnapStyle[]; variants: SnapVariant[] } {
  const styles: SnapStyle[] = []
  for (const r of REKEY) {
    if (!r.from) continue
    const s = styles.find((x) => x.number === r.from) ?? (() => { const n = { id: `s_${r.from}`, number: r.from!, name: r.name, status: 'ACTIVE', sizes: 'OS', notes: r.from === 'BG103' ? 'Kit: PT101 body + AC102 handle.' : null, products: [] as SnapStyle['products'] }; styles.push(n); return n })()
    for (const p of r.products) s.products.push({ id: `p_${p}`, name: p })
  }
  styles.find((s) => s.number === 'BG105')!.products.push({ id: 'p_Red Bag', name: 'Red Bag' })
  styles.find((s) => s.number === 'AC103')!.products.push({ id: 'p_Hair Tie', name: 'Hair Tie' })
  const variants: SnapVariant[] = [
    { id: 'v1', productId: 'p_Cleo Tee', newSku: 'TP101-BLK-01', colorCode: 'BLK', sizeCode: '01' },
    { id: 'v2', productId: 'p_Cleo Bag — Denim', newSku: 'BG101-DBL-OS', colorCode: 'DBL', sizeCode: 'OS' },
    { id: 'v3', productId: 'p_Cleo Bag — Olive', newSku: 'BG101-OLV-OS', colorCode: 'OLV', sizeCode: 'OS' },
    { id: 'v4', productId: 'p_Bateau Body — Muslin Canvas (part)', newSku: 'PT101-NAT-OS', colorCode: 'NAT', sizeCode: 'OS' },
    { id: 'v5', productId: 'p_Cleo Tee', newSku: null, colorCode: null, sizeCode: null },
  ]
  return { styles, variants }
}

test('the plan: renumbered in place, Denim split onto HCD101, Wilde\'s created, Dolce unnumbered, every old number retired', () => {
  const { styles, variants } = snapshot()
  const plan = planRekey(styles, variants)
  assert.deepEqual(plan.problems, [])
  assert.equal(plan.renumber.find((r) => r.from === 'TP101')?.to, 'TCO101')
  assert.equal(plan.renumber.find((r) => r.from === 'BG101')?.to, 'HCB101')
  const denim = plan.create.find((c) => c.number === 'HCD101')!
  assert.deepEqual(denim.productIds, ['p_Cleo Bag — Denim'])
  assert.equal(plan.create.find((c) => c.number === 'TCW101')?.createProduct?.name, "Cleo Tee Wilde's")
  assert.deepEqual(plan.unlink.map((u) => u.name), ['Dolce'])
  assert.deepEqual(plan.remove.map((r) => r.number), ['DR106'])
  const retired = new Map(plan.retire.map((r) => [r.number, r]))
  assert.equal(retired.size, new Set(REKEY.flatMap((r) => (r.from ? [r.from] : []))).size, 'every old number, once')
  assert.equal(retired.get('BG101')?.replacedBy, 'HCB101')
  assert.match(retired.get('BG101')!.note, /HCB101 and HCD101/)
  assert.equal(retired.get('DR106')?.replacedBy, null)
})

test('the plan: SKUs keep colour and size, swap the style; Olive stays a Cleo Bag colourway, Denim moves', () => {
  const { styles, variants } = snapshot()
  const skus = new Map(planRekey(styles, variants).skus.map((s) => [s.from, s.to]))
  assert.deepEqual(Object.fromEntries(skus), { 'TP101-BLK-01': 'TCO101-BLK-01', 'BG101-DBL-OS': 'HCD101-DBL-OS', 'BG101-OLV-OS': 'HCB101-OLV-OS', 'PT101-NAT-OS': 'XBT101-NAT-OS' })
})

test('the plan refuses anything that does not fit: a style or product not in the table, a SKU that disagrees with its codes', () => {
  const { styles, variants } = snapshot()
  styles.push({ id: 's_X', number: 'ZZ101', name: 'Mystery', status: 'ACTIVE', sizes: null, notes: null, products: [] })
  styles.find((s) => s.number === 'TP101')!.products.push({ id: 'p_new', name: 'Cleo Tee Two' })
  variants.push({ id: 'v9', productId: 'p_Cleo Tee', newSku: 'TP101-WHT-02', colorCode: 'BLK', sizeCode: '02' })
  const problems = planRekey(styles, variants).problems.join('\n')
  assert.match(problems, /ZZ101 \(Mystery\) is not in the re-key table/)
  assert.match(problems, /"Cleo Tee Two" on TP101 is not in the re-key table/)
  assert.match(problems, /TP101-WHT-02 does not match its own colour and size codes/)
  const missing = snapshot()
  missing.styles.splice(missing.styles.findIndex((s) => s.number === 'AC104'), 1)
  assert.match(planRekey(missing.styles, missing.variants).problems.join('\n'), /No style AC104/)
})

test('the duplicates being merged are exactly the two named', () => {
  assert.deepEqual(MERGES, [['Red Bag', 'Bean Bag'], ['Hair Tie', 'Flower Hair Tie']])
})

test('notes keep what they said, old codes swapped, and add the table\'s note only when it is new', () => {
  assert.equal(swapCodes('Kit: PT101 body + AC102 handle; see CCSS25COT and PO 2403.'), 'Kit: XBT101 body + ABH101 handle; see CCSS25COT and PO 2403.')
  assert.equal(rekeyedNotes('Petite and Medium are sizes.', 'Merged.'), 'Petite and Medium are sizes. Merged.')
  assert.equal(rekeyedNotes(null, undefined), null)
  assert.equal(rekeyedNotes('Already says Merged.', 'Merged.'), 'Already says Merged.')
})

test('old codes still find the product: a retired style number and SKUs of every generation', () => {
  const tee = { kind: 'product' as const, id: 'p_tee', name: 'Cleo Tee', keys: ['p_tee', 'Cleo Tee', 'TCO101', 'TP101', 'TCO101-BLK-01', 'TP101-BLK-01', 'CCSS25COT-BLK01'] }
  const bag = { kind: 'product' as const, id: 'p_bag', name: 'Bean Bag', keys: ['p_bag', 'Bean Bag', 'HBN101', 'BG105'] }
  for (const said of ['how many TP101 do we have', 'TP101-BLK-01 is low', 'CCSS25COT-BLK01 came back', 'check TCO101-BLK-01']) {
    assert.deepEqual(mentionedRecords(said, [tee, bag]).found.map((r) => r.id), ['p_tee'], said)
  }
  assert.deepEqual(mentionedRecords('the BG105 reorder', [tee, bag]).found.map((r) => r.id), ['p_bag'])
})

test('a sent PO line reads exactly the same after the re-key; a draft picks up the new SKU', () => {
  const before = { sku: 'CCSS25COT-BLK02', newSku: 'TP101-BLK-02', size: '2', imageUrl: null, product: { name: 'Cleo Tee' }, colorway: { customerName: 'Black' } }
  const after = { ...before, newSku: 'TCO101-BLK-02' }
  const sent = { snapshotAt: new Date('2026-10-01'), snapSku: 'TP101-BLK-02 (was CCSS25COT-BLK02)', snapProductName: 'Cleo Tee', snapColorway: 'Black', snapSize: '2', snapImageUrl: null }
  const label = (v: typeof before) => lineLabel(lineView({ ...sent, productVariant: v }, 'transition')!, 'Style')
  assert.equal(label(after), label(before))
  assert.equal(label(after), 'Style TP101-BLK-02 (was CCSS25COT-BLK02) — Cleo Tee — Black / 2')
  assert.equal(lineLabel(lineView({ productVariant: after }, 'transition')!, 'Style'), 'Style TCO101-BLK-02 (was CCSS25COT-BLK02) — Cleo Tee — Black / 2')
})
