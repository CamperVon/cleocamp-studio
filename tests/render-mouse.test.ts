import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { renderMouseText } from '../app/ui/chat'

const html = (t: string) => renderToStaticMarkup(createElement('div', null, ...renderMouseText(t))).replace(/ class="[^"]*"/g, '')

test('a table in a reply is drawn as a table, not shown as pipes', () => {
  const h = html('Counts:\n\n| Size | Red |\n|---|---|\n| XS | 13 |\n\nDone.')
  assert.match(h, /<table><thead><tr><th>Size<\/th><th>Red<\/th><\/tr><\/thead><tbody><tr><td>XS<\/td><td>13<\/td><\/tr><\/tbody><\/table>/)
  assert.doesNotMatch(h, /\|/)
})

test('plain replies are unchanged: bold and paths still work', () => {
  assert.equal(html('See **PO 2360** at /po/2360.'), '<div><span>See <strong>PO 2360</strong> at <a href="/po/2360" target="_blank" rel="noreferrer">/po/2360</a>.</span></div>')
})
