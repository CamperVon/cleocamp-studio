import { test } from 'node:test'
import assert from 'node:assert/strict'
import { byName, cleanContact } from '../lib/contacts'

test('kept as given, tidied only at the edges', () => {
  const c = cleanContact({ name: ' Audrey Hiau ', role: 'Shopping Editor', email: 'Audry.Hiaoui@futurenet.com', instagram: '@audrey' }, true)
  assert.deepEqual(c, { data: { name: 'Audrey Hiau', role: 'Shopping Editor', email: 'audry.hiaoui@futurenet.com', instagram: 'audrey' } })
})

test('a name is required; a bad email is refused; blank clears', () => {
  assert.ok('error' in cleanContact({ role: 'Editor' }, true))
  assert.ok('error' in cleanContact({ name: 'X', email: 'not an email' }, true))
  assert.deepEqual(cleanContact({ phone: '' }, false), { data: { phone: null } })
  assert.ok('error' in cleanContact({ name: '' }, false))
})

test('A to Z, ignoring case', () => {
  assert.deepEqual([{ name: 'laufey' }, { name: 'Audrey Hiau' }, { name: 'Zoë' }, { name: 'Álvaro' }].sort(byName).map((x) => x.name), ['Álvaro', 'Audrey Hiau', 'laufey', 'Zoë'])
})

test('kept at the top comes first, then A to Z', () => {
  assert.deepEqual([{ name: 'Brandon Camp' }, { name: 'Cleo Camp', atTop: true }, { name: 'Anna' }].sort(byName).map((x) => x.name), ['Cleo Camp', 'Anna', 'Brandon Camp'])
})
