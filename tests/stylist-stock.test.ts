import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findPullLine, piecesOf, pieceName, pieceStatus, returnSplit, splitPull, stockNote } from '../lib/stylist-stock'

test('a pull takes from the stylist inventory first, and from sales only as far as a person agreed', () => {
  assert.deepEqual(splitPull(3, 5), { fromStylist: 3, fromSales: 0, short: 0 })
  assert.deepEqual(splitPull(3, 1), { fromStylist: 1, fromSales: 0, short: 2 })
  assert.deepEqual(splitPull(3, 1, 2), { fromStylist: 1, fromSales: 2, short: 0 })
  assert.deepEqual(splitPull(3, 0, 1), { fromStylist: 0, fromSales: 1, short: 2 })
  assert.deepEqual(splitPull(2, -4, 9), { fromStylist: 0, fromSales: 2, short: 0 }) // never more than needed
})

test('returns refill sales stock first, then the stylist inventory', () => {
  const line = { qty: 3, fromStylistQty: 1, returnedQty: 0 } // 2 came from sales
  assert.deepEqual(returnSplit(line, 1), { toSales: 1, toStylist: 0 })
  assert.deepEqual(returnSplit(line, 3), { toSales: 2, toStylist: 1 })
  assert.deepEqual(returnSplit({ ...line, returnedQty: 2 }, 1), { toSales: 0, toStylist: 1 })
  // Pulls from before the stylist inventory took everything from sales.
  assert.deepEqual(returnSplit({ qty: 1, fromStylistQty: 0, returnedQty: 0 }, 1), { toSales: 1, toStylist: 0 })
})

test('a piece reads as a person says it, with its stock in a few words', () => {
  assert.equal(pieceName('Cleo Tee', 'Black', '1'), 'Cleo Tee, Black, Size 1')
  assert.equal(pieceName('Boy Belt', null, 'Small'), 'Boy Belt, Size Small')
  const v = new Map([['a', { label: 'Cleo Tee, Black, Size 1', onHand: 0 }], ['b', { label: 'Story Dress, Green, Size 1', onHand: 4 }]])
  const [tee, dress] = pieceStatus([{ productVariantId: 'a', qty: 1 }, { productVariantId: 'b', qty: 1 }], new Map([['b', 2]]), v)
  assert.equal(stockNote(tee), 'out of stock')
  assert.equal(stockNote(dress), 'in stylist inventory')
  const [short] = pieceStatus([{ productVariantId: 'b', qty: 3 }], new Map([['b', 1]]), v)
  assert.equal(stockNote(short), 'only 1 in stylist inventory · 4 in sales stock')
  const [agreed] = pieceStatus([{ productVariantId: 'b', qty: 3, fromSales: 2 }], new Map([['b', 1]]), v)
  assert.equal(stockNote(agreed), '1 from stylist inventory, 2 from sales stock')
})

test('a request\'s pieces are read back safely', () => {
  assert.deepEqual(piecesOf([{ productVariantId: 'a', qty: '2' }, { productVariantId: 'b', qty: 0 }, { qty: 1 }, null, { productVariantId: 'c', qty: 1, fromSales: 1 }]),
    [{ productVariantId: 'a', qty: 2 }, { productVariantId: 'c', qty: 1, fromSales: 1 }])
  assert.deepEqual(piecesOf(null), [])
})

test('a request folds to a short name: the shoot in quotes, else its first phrase', async () => {
  const { requestTitle } = await import('../lib/stylists')
  assert.equal(requestTitle('Pull for "Kendall at Home" (Kendall Jenner, shot by Paige Powell): tees'), 'Kendall at Home')
  assert.equal(requestTitle('Pull of the pieces in her list, for the film "Love of Your Life" (7 and 8 Oct)'), 'Love of Your Life')
  assert.equal(requestTitle('Story Dress, You Dress (black/white), and Cleo bags'), 'Story Dress, You Dress')
  assert.ok(requestTitle('A very long request with no quotes and no break in it anywhere at all for a while').length <= 49)
})

// 19 Nov 2026: a piece sent from sales stock while the stylist inventory held one.
test('a piece a person says came from sales stock leaves the stylist inventory alone', () => {
  assert.deepEqual(splitPull(1, 1, 0, true), { fromStylist: 0, fromSales: 1, short: 0 })
  assert.deepEqual(splitPull(1, 1), { fromStylist: 1, fromSales: 0, short: 0 })
  // Back again, it refills sales stock, which is where it came from.
  assert.deepEqual(returnSplit({ qty: 1, fromStylistQty: 0, returnedQty: 0 }, 1), { toSales: 1, toStylist: 0 })
})

test('a returned piece is found on its pull by the item, without a line id', () => {
  const lines = [
    { id: 'l1', item: 'Cleo Tee Splish 1', productVariantId: 'v_splish1', qty: 1, returnedQty: 0 },
    { id: 'l2', item: 'Boy Belt S', productVariantId: 'v_belt', qty: 1, returnedQty: 0 },
  ]
  assert.equal(findPullLine(lines, { productVariantId: 'v_splish1' }).line?.id, 'l1')
  assert.equal(findPullLine(lines, { lineId: 'l2' }).line?.id, 'l2')
  const missing = findPullLine(lines, { productVariantId: 'v_other' })
  assert.equal(missing.line, null)
  assert.match((missing as { reason: string }).reason, /lineId l1/)
})

test('the same piece twice on a pull: the one still out is taken, or a line id is asked for', () => {
  const twice = [
    { id: 'a', item: 'Cleo Tee Black 1', productVariantId: 'v', qty: 1, returnedQty: 1 },
    { id: 'b', item: 'Cleo Tee Black 1', productVariantId: 'v', qty: 1, returnedQty: 0 },
  ]
  assert.equal(findPullLine(twice, { productVariantId: 'v' }, 'out').line?.id, 'b')
  assert.equal(findPullLine(twice, { productVariantId: 'v' }, 'back').line?.id, 'a')
  const both = twice.map((l) => ({ ...l, returnedQty: 0 }))
  assert.match((findPullLine(both, { productVariantId: 'v' }) as { reason: string }).reason, /more than once/)
})
