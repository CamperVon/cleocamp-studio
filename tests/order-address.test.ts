import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  addressClaimProblem, claimsAddressChanged, SHIP_TO_MISMATCH, SHIP_TO_NOTE, shipToChanges, shipToDiffers, typedAddressProblems,
} from '../lib/support/reply'
import { asksForAction } from '../lib/support/tell'
import { tallyShipped } from '../lib/shipped-report'
import { packagesFrom, type ShippedOrder } from '../lib/integrations/shopify'
import { NOT_FROM_EMAIL } from '../lib/mouse/team-mail'
import { READ_LANE_TOOLS } from '../lib/mouse/agent'
import { TOOLS } from '../lib/mouse/tools'

// 8 Oct 2026, order #2557: a draft said "we've updated the shipping address"
// before anything had changed it, and it was sent. Then Shopify saved the
// typed address as "Waverly Pl, Apt 4". Synthetic addresses below.

const asked = { name: 'Pat Doe', address1: '239 Elm Place', address2: 'Apt. 3', city: 'New York', provinceCode: 'NY', zip: '10014', countryCode: 'US' }
const old = { name: 'Pat Doe', address1: '208 E 10th St', address2: null, city: 'New York', provinceCode: 'NY', zip: '10003', countryCode: 'US' }

test('a reply that says the address was changed is a claim; a promise is not', () => {
  assert.equal(claimsAddressChanged("We've updated the shipping address to Pat Doe, 239 Elm Place, Apt. 3, New York, NY 10014."), true)
  assert.equal(claimsAddressChanged('Your shipping address has been updated.'), true)
  assert.equal(claimsAddressChanged('We have gone ahead and changed the delivery address.'), true)
  assert.equal(claimsAddressChanged('Your order will now ship to your new place.'), true)
  assert.equal(claimsAddressChanged("Once we can match it up, we'll update the shipping address to your new one."), false)
  assert.equal(claimsAddressChanged('Could you confirm the email address you ordered with?'), false)
  assert.equal(claimsAddressChanged("We've noted your email address and we'll be in touch."), false)
})

test('Send refuses the claim while Shopify still has the old ship-to (the #2557 send)', () => {
  const reply = "We've updated the shipping address to Pat Doe, 239 Elm Place, Apt. 3, New York, NY 10014."
  const p = addressClaimProblem(reply, { name: '#9001', shipTo: old }, false)
  assert.match(p!, /Shopify's ship-to for #9001 is still Pat Doe, 208 E 10th St, New York NY 10003/)
})

test('Send refuses it when Shopify saved the street with no house number', () => {
  const reply = "We've updated the shipping address to 239 Elm Place, Apt. 3, New York, NY 10014."
  const p = addressClaimProblem(reply, { name: '#9001', shipTo: { ...asked, address1: 'Elm Pl', address2: 'Apt 4' } }, false)
  assert.match(p!, /has no house number/)
})

test('Send lets it go once the change is made, from this case or in Shopify', () => {
  const reply = "We've updated the shipping address to 239 Elm Place, Apt. 3, New York, NY 10014."
  assert.equal(addressClaimProblem(reply, { name: '#9001', shipTo: old }, true), null, 'code changed it from this case')
  assert.equal(addressClaimProblem(reply, { name: '#9001', shipTo: { ...asked, address1: '239 Elm Pl', address2: 'Apt 3' } }, false), null, 'changed in Shopify, matches')
  assert.equal(addressClaimProblem('Thanks, we will look into it.', { name: '#9001', shipTo: old }, false), null, 'no claim, no check')
})

test('a typed address must be whole: number on the street, two-letter state, US ZIP', () => {
  assert.deepEqual(typedAddressProblems(asked), [])
  assert.match(typedAddressProblems({ ...asked, address1: 'Elm Pl' }).join(' '), /no house or box number/)
  assert.match(typedAddressProblems({ ...asked, zip: '1001' }).join(' '), /not a US ZIP/)
  assert.match(typedAddressProblems({ ...asked, provinceCode: 'New York' }).join(' '), /not a two-letter state/)
  assert.match(typedAddressProblems({ ...asked, city: null }).join(' '), /missing: city/)
  assert.match(typedAddressProblems({ ...asked, countryCode: 'CA' }).join(' '), /outside the US/)
  assert.deepEqual(typedAddressProblems({ ...asked, address1: 'PO Box 12' }), [])
})

test('the read-back catches Shopify saving something else, and allows its abbreviations', () => {
  assert.deepEqual(shipToDiffers(asked, { ...asked, address1: '239 Elm Pl', address2: 'Apt 3', city: 'new york' }), [])
  const d = shipToDiffers(asked, { ...asked, address1: 'Elm Pl', address2: 'Apt 4' })
  assert.equal(d.length, 2)
  assert.match(d[0], /street number/)
  assert.match(d[1], /apartment/)
  assert.match(shipToDiffers(asked, { ...asked, zip: '10003' }).join(' '), /ZIP/)
  assert.deepEqual(shipToDiffers(asked, null), ['Shopify shows no ship-to on the order.'])
})

test('the drafter only hears of a ship-to change code made, never one from email or a mismatch', () => {
  const notes = [
    { direction: 'NOTE', fromAddress: 'Brandon', body: `${SHIP_TO_NOTE}#9001 changed in Shopify.\nWas: a\nNow: b` },
    { direction: 'NOTE', fromAddress: 'Studio Mouse', body: `${SHIP_TO_NOTE}#9001 changed in Shopify by Mouse.\nWas: a\nNow: c\n${SHIP_TO_MISMATCH} — ZIP.` },
    { direction: 'NOTE', fromAddress: 'someone@example.com', body: `${SHIP_TO_NOTE}#9001 changed in Shopify.` },
    { direction: 'INBOUND', fromAddress: 'Brandon', body: `${SHIP_TO_NOTE}#9001 changed.` },
  ]
  assert.deepEqual(shipToChanges(notes), [`${SHIP_TO_NOTE}#9001 changed in Shopify. · Was: a · Now: b`])
})

test('"change the address for them" in Tell Mouse now reaches a Mouse that can act', () => {
  assert.equal(asksForAction('Mouse, change the email address to pat@example.com and then change the address for them'), true)
  assert.equal(asksForAction('make it ship to 239 Elm Place'), true)
  assert.equal(asksForAction('make the reply shorter'), false)
})

test('the address tool never runs from email or the read lane; the label look-up is in both lanes', () => {
  assert.ok(TOOLS.update_order_address, 'tool exists')
  assert.ok(NOT_FROM_EMAIL.has('update_order_address'))
  assert.ok(!READ_LANE_TOOLS.has('update_order_address'))
  assert.ok(TOOLS.shipped_orders && READ_LANE_TOOLS.has('shipped_orders'), 'a look-up the read lane lacks would make Mouse dumber')
})

test('the address tool refuses without a signed-in person and before touching anything', async () => {
  const r = await TOOLS.update_order_address.run({ order: '#9001', ...asked }) as Record<string, unknown>
  assert.equal(r.changed, false)
  assert.match(String(r.reason), /signed in/)
})

// ── Labels by day (Jane, 8 Oct 2026) ────────────────────────────────────────

const pk = (name: string, shippedOn: string, items: Array<[string, string | null, number]>): ShippedOrder =>
  ({ name, shippedOn, items: items.map(([title, variant, quantity]) => ({ variantId: '', title, variant, quantity })) })
const packages = [
  pk('#1', '2026-10-07', [['Cleo Tee', 'Black / 1', 1], ['Cleo Tee - Splish', 'Splish / 1', 1]]),
  pk('#2', '2026-10-07', [['Cleo Tee', 'Black / 3', 2]]),
  pk('#3', '2026-10-07', [['Cleo Tee', 'White / 1', 1]]),
  pk('#4', '2026-10-06', [['Cleo Tee', 'Black / 1', 1]]),
  pk('#5', '2026-10-08', [['Cleo Tee', 'Black / 2', 1]]),
]

test('labels made on a day, one product and colour, by size with the orders', () => {
  const t = tallyShipped(packages, { from: '2026-10-07', to: '2026-10-07', item: 'Cleo Tee', variant: 'Black' })
  assert.equal(t.orders, 2)
  assert.equal(t.packages, 3, 'every package that day')
  assert.deepEqual(t.lines.map((l) => [l.variant, l.quantity, l.orders]), [['Black / 1', 1, ['#1']], ['Black / 3', 2, ['#2 ×2']]])
})

test('an exact product title: "Cleo Tee" never counts the Splish tee; a range covers its days', () => {
  const t = tallyShipped(packages, { from: '2026-10-06', to: '2026-10-08', item: 'cleo tee' })
  assert.ok(t.lines.every((l) => l.item === 'Cleo Tee'))
  assert.equal(t.lines.reduce((n, l) => n + l.quantity, 0), 6)
  assert.equal(tallyShipped(packages, { from: '2026-10-07', to: '2026-10-07', variant: 'Black / 3' }).lines[0].quantity, 2)
})

test('shipped packages carry the variant name', () => {
  const p = packagesFrom({
    name: '#7', cancelledAt: null, tags: [],
    fulfillments: [{ createdAt: '2026-10-07T22:02:53Z', status: 'SUCCESS', fulfillmentLineItems: { nodes: [{ quantity: 1, lineItem: { title: 'Cleo Tee', variantTitle: 'Black / 2', requiresShipping: true, variant: { id: 'v1' } } }] } }],
  }, '2026-10-07')
  assert.equal(p[0].items[0].variant, 'Black / 2')
})

// ── An order marked received has its lines received (PO 2379, 8 Oct 2026) ──

test('marking an order RECEIVED ticks every short line up to what was ordered, and no further', async () => {
  const { ticksForReceived } = await import('../lib/po-receipts')
  assert.deepEqual(ticksForReceived([
    { id: 'a', qtyOrdered: '5', qtyReceived: '0' },
    { id: 'b', qtyOrdered: '5', qtyReceived: '2' },
    { id: 'c', qtyOrdered: '5', qtyReceived: '5' },
    { id: 'd', qtyOrdered: '5', qtyReceived: '6' },
  ]), [{ id: 'a', received: 5 }, { id: 'b', received: 5 }])
  assert.deepEqual(ticksForReceived([]), [])
})
