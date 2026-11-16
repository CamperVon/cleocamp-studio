import { test } from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import { LineSheetDoc, lineSheetFileName, onTheStylistPdf, onThePdf, sheetForOf, sheetPhoto, stylistTitle, type LineSheetLine } from '../lib/line-sheet'

// 15 Nov 2026: Cleo wanted a stylist version of the line sheet: the same
// pieces, bigger photos, and no wholesale, retail or minimum-order columns.

const row = (over: Partial<LineSheetLine> = {}): LineSheetLine => ({
  id: 'r1', position: 1, productId: null, colorway: null, item: 'Cleo Tee', style: null, colorLabel: 'Shell',
  description: 'A soft cotton tee.', ownDescription: '', wholesaleCents: 4400, wholesaleMaxCents: null,
  retail: '$88', msrp: null, sizing: 'XS–L', minOrder: '6 units', availability: 'In Stock',
  photo: null, photoData: null, onHand: 3, hidden: false, ...over,
})
const meta = { title: 'Cleo Standard Collection – Wholesale Line Sheet', tagline: '', materials: '', press: '', contact: '', footnote: 'Minimum order $500. Net 30.' }

test('the stylist sheet is asked for by ?for=stylists, and nothing else switches it', () => {
  assert.equal(sheetForOf('stylists'), 'stylists')
  assert.equal(sheetForOf(null), 'wholesale')
  assert.equal(sheetForOf('Stylists'), 'wholesale')
})

test('a row with no wholesale price still goes to stylists, since they see no price', () => {
  const r = row({ wholesaleCents: null })
  assert.equal(onThePdf(r), false)
  assert.equal(onTheStylistPdf(r), true)
  assert.equal(onTheStylistPdf(row({ hidden: true })), false)
  assert.equal(onTheStylistPdf(row({ description: '  ' })), false)
})

test('the title drops "Wholesale" and the file is named for stylists', () => {
  assert.equal(stylistTitle(meta.title), 'Cleo Standard Collection – Stylist Line Sheet')
  assert.equal(stylistTitle(''), 'Cleo Camp – Stylist Line Sheet')
  const d = new Date('2026-11-15T20:00:00Z')
  assert.equal(lineSheetFileName(d, 'pdf', 'stylists'), 'Cleo-Camp-Stylist-Line-Sheet-2026-11-15.pdf')
  assert.equal(lineSheetFileName(d), 'Cleo-Camp-Line-Sheet-2026-11-15.pdf')
})

test('stylist photos are fetched at twice the width', () => {
  assert.match(sheetPhoto('https://cdn.shopify.com/a.jpg', 480)!, /width=480&format=jpg$/)
  assert.match(sheetPhoto('https://cdn.shopify.com/a.jpg')!, /width=240&format=jpg$/)
})

test('both sheets render, and differ', async () => {
  const asOf = new Date('2026-11-15T20:00:00Z')
  const lines = [row(), row({ id: 'r2', colorLabel: 'Black', minOrder: '6 units' })]
  const ws = await renderToBuffer(React.createElement(LineSheetDoc, { meta, lines, asOf }) as unknown as Parameters<typeof renderToBuffer>[0])
  const st = await renderToBuffer(React.createElement(LineSheetDoc, { meta, lines, asOf, for: "stylists" }) as unknown as Parameters<typeof renderToBuffer>[0])
  assert.equal(ws.subarray(0, 4).toString(), '%PDF')
  assert.equal(st.subarray(0, 4).toString(), '%PDF')
  assert.notEqual(ws.length, st.length)
})
