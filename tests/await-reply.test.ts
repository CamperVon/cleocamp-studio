import { test } from 'node:test'
import assert from 'node:assert/strict'
import { awaitReply } from '../app/ui/chat'

// The phone dropped the request; the server finished the turn anyway. The
// first poll finds the user's message still waiting, the second finds the
// reply — which must come back instead of "Load failed".
test('picks up a reply that landed after the connection dropped', async () => {
  const thread = [
    { role: 'user', text: 'earlier' }, { role: 'assistant', text: 'earlier reply' },
    { role: 'user', text: 'From Lorena.' },
  ]
  let calls = 0
  globalThis.fetch = (async () => {
    calls++
    if (calls === 2) thread.push({ role: 'assistant', text: 'Logged against PO 2371.' })
    return new Response(JSON.stringify({ messages: thread }), { status: 200 })
  }) as typeof fetch
  const got = await awaitReply('t1', 'From Lorena.', () => true)
  assert.ok(Array.isArray(got))
  assert.equal((got as { text: string }[]).at(-1)!.text, 'Logged against PO 2371.')
})

test('an earlier reply to an earlier message does not count', async () => {
  const thread = [{ role: 'user', text: 'From Lorena.' }, { role: 'assistant', text: 'old' }, { role: 'user', text: 'From Lorena.' }]
  let calls = 0
  globalThis.fetch = (async () => {
    calls++
    return new Response(JSON.stringify({ messages: thread }), { status: 200 })
  }) as typeof fetch
  const got = await awaitReply('t1', 'From Lorena.', () => calls < 2)
  assert.equal(got, 'timeout')
})
