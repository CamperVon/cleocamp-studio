import assert from 'node:assert/strict'
import test from 'node:test'
import { runLoop, requireComplete } from '../lib/mouse/runner'
import { completedWrites, diagnosticValue } from '../lib/mouse/outcomes'
import type Anthropic from '@anthropic-ai/sdk'

const usage = { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 20, cache_creation_input_tokens: 10 } as Anthropic.Usage
const toolUse = (name: string, id = name): Anthropic.ToolUseBlock => ({ type: 'tool_use', caller: { type: 'direct' }, name, id, input: { poNumber: 'TEST-1' } })
const response = (content: Anthropic.ContentBlock[], stop_reason: Anthropic.StopReason = 'tool_use') => ({ content, stop_reason, usage })
const answer = response([{ type: 'text', text: 'Done.', citations: null }], 'end_turn')
const defs: Anthropic.Tool[] = ['update_purchase_order', 'send_purchase_order', 'request_deep_analysis', 'query_status', 'create_purchase_order']
  .map(name => ({ name, input_schema: { type: 'object' } }))
const base = { system: [], messages: [{ role: 'user' as const, content: 'Prepare my order.' }], tools: defs, model: 'normal', deepModel: 'deep' }

test('returned failures are fed back as errors and never become completed badges', async () => {
  let n = 0
  const r = await runLoop({ ...base,
    create: async req => {
      if (n++ === 0) return response([toolUse('send_purchase_order')])
      const last = req.messages.at(-1)!.content as Anthropic.ToolResultBlockParam[]
      assert.equal(last[0].is_error, true)
      return answer
    }, execute: async () => ({ sent: false, reason: 'Supplier email missing' }),
  })
  assert.equal(r.writes.length, 0)
  assert.equal(r.toolCalls[0].status, 'failed')
  assert.deepEqual(completedWrites(r.toolCalls), [])
  assert.equal(r.usage.requests[0].cacheReadTokens, 20)
})

test('escalation preserves sibling calls and their results instead of restarting writes', async () => {
  let n = 0, writes = 0
  const r = await runLoop({ ...base,
    create: async req => {
      if (n++ === 0) return response([toolUse('request_deep_analysis'), toolUse('update_purchase_order')])
      assert.equal(req.model, 'deep')
      assert.equal((req.messages.at(-1)!.content as unknown[]).length, 2)
      return answer
    }, execute: async () => { writes++; return { updated: true } },
  })
  assert.equal(writes, 1)
  assert.equal(r.writes.length, 1)
  assert.equal(r.model, 'deep')
})

test('round budget preserves successful writes and leaves a nonempty stopping point', async () => {
  let writes = 0
  const r = await runLoop({ ...base, maxRequests: 1,
    create: async () => response([toolUse('update_purchase_order')]),
    execute: async () => { writes++; return { updated: true } },
  })
  assert.equal(writes, 1)
  assert.equal(r.usage.stopReason, 'budget')
  assert.match(r.text, /1 action completed/)
  assert.equal(r.writes.length, 1)
})

test('provider failure after a write preserves the result; no automatic replay', async () => {
  let n = 0
  const r = await runLoop({ ...base,
    create: async () => { if (n++ === 0) return response([toolUse('update_purchase_order')]); throw new Error('offline') },
    execute: async () => ({ updated: true }),
  })
  assert.equal(r.usage.stopReason, 'provider_error')
  assert.equal(r.writes.length, 1)
  assert.match(r.text, /connection failed/)
  assert.equal(r.usage.attemptedRequests, 2)
  assert.equal(r.usage.providerError, 'offline')
  assert.throws(() => requireComplete(r), /connection failed/)
})

test('unavailable tools cannot execute even when a model requests one', async () => {
  let n = 0, executed = false
  const r = await runLoop({ ...base,
    create: async () => n++ === 0 ? response([toolUse('delete_database')]) : answer,
    execute: async () => { executed = true },
  })
  assert.equal(executed, false)
  assert.equal(r.toolCalls[0].status, 'failed')
})

test('a write that sends no email is still a success, not a failure', async () => {
  let n = 0
  const r = await runLoop({ ...base,
    create: async () => n++ === 0 ? response([toolUse('create_purchase_order')]) : answer,
    execute: async () => ({ poNumber: 'TEST-1', emailSent: false, document: '/po/TEST-1' }),
  })
  assert.equal(r.writes.length, 1)
})

test('output budget caps each request and counts actual model usage', async () => {
  let n = 0
  const r = await runLoop({ ...base, maxOutputTokens: 1024,
    create: async req => {
      n++
      assert.equal(req.max_tokens, 1024)
      return { ...answer, stop_reason: 'max_tokens', usage: { ...usage, output_tokens: 1024 } }
    }, execute: async () => ({}),
  })
  assert.equal(n, 1)
  assert.equal(r.usage.stopReason, 'budget')
  assert.equal(r.usage.requests[0].outputTokens, 1024)
})

test('legacy input-only tool records are not proof of success; diagnostics remove credentials', () => {
  assert.deepEqual(completedWrites([{ name: 'send_email', input: {} }]), [])
  const safe = diagnosticValue({ secret: 'hidden', base64: 'binary', error: 'postgresql://user:password@example/db Bearer abc sk-ant-test123', amount: BigInt(1200) })
  const text = JSON.stringify(safe)
  assert.doesNotMatch(text, /password@example|abc|sk-ant-test123|binary|hidden/)
  assert.match(text, /1200/)
})

test('a request that runs out of room thinking, before any action, is retried once at low effort', async () => {
  // 23 Sept 2026: a long bag update spent a whole request thinking and the
  // turn ended with no change made and most of its budget unused.
  const seen: Array<{ effort?: string; nudged: boolean }> = []
  let writes = 0
  const r = await runLoop({ ...base, maxOutputTokens: 24000,
    create: async req => {
      const last = req.messages.at(-1)!.content
      seen.push({
        effort: (req as { output_config?: { effort?: string } }).output_config?.effort,
        nudged: Array.isArray(last) && JSON.stringify(last).includes('Start making the tool calls now'),
      })
      if (seen.length === 1) return { content: [], stop_reason: 'max_tokens', usage: { ...usage, output_tokens: 16000 } }
      if (seen.length === 2) return response([toolUse('update_purchase_order')])
      return answer
    }, execute: async () => { writes++; return { updated: true } },
  })
  assert.equal(seen[0].effort, 'medium')
  assert.deepEqual(seen[1], { effort: 'low', nudged: true })
  assert.equal(writes, 1)
  assert.equal(r.usage.stopReason, 'complete')
})

test('the overthinking retry happens only once', async () => {
  let n = 0
  const r = await runLoop({ ...base, maxOutputTokens: 64000,
    create: async () => { n++; return { content: [], stop_reason: 'max_tokens', usage: { ...usage, output_tokens: 8000 } } },
    execute: async () => ({}),
  })
  assert.equal(n, 2)
  assert.equal(r.usage.stopReason, 'budget')
})

test('one-hour cache writes are counted apart from five-minute ones', async () => {
  const u = { ...usage, cache_creation_input_tokens: 30, cache_creation: { ephemeral_5m_input_tokens: 5, ephemeral_1h_input_tokens: 25 } } as Anthropic.Usage
  const r = await runLoop({
    create: async () => ({ content: [{ type: 'text', text: 'ok', citations: null } as Anthropic.TextBlock], stop_reason: 'end_turn', usage: u }),
    system: [], messages: [{ role: 'user', content: 'hi' }], tools: [], execute: async () => null,
    model: 'm', deepModel: 'd',
  })
  assert.equal(r.usage.requests[0].cacheWriteTokens, 30)
  assert.equal(r.usage.requests[0].cacheWrite1hTokens, 25)
})

test('tool results with dates and Decimals come out as plain JSON a chat turn can be saved with', async () => {
  const { diagnosticValue } = await import('../lib/mouse/outcomes')
  const { Prisma } = await import('../generated/prisma/client')
  const out = diagnosticValue([{ deltaQty: new Prisma.Decimal('2200'), createdAt: new Date('2026-09-12T10:00:00Z'), fn: () => 1 }]) as Array<Record<string, unknown>>
  assert.equal(out[0].deltaQty, '2200')
  assert.equal(out[0].createdAt, '2026-09-12T10:00:00.000Z')
  assert.equal(out[0].fn, undefined)
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(out)))
})

test('the weekly review only suggests real open items, once each, with a reason', async () => {
  const { parseSuggestions } = await import('../lib/mouse/tidy')
  const open = new Set(['a', 'b'])
  const got = parseSuggestions('Here:\n[{"id":"a","why":"PO 2363 was cancelled."},{"id":"a","why":"dup"},{"id":"zzz","why":"not open"},{"id":"b","why":""}]', open)
  assert.deepEqual(got, [{ id: 'a', why: 'PO 2363 was cancelled.' }])
  assert.deepEqual(parseSuggestions('nothing to close', open), [])
  assert.deepEqual(parseSuggestions('[]', open), [])
})

test('an answer written alongside a tool call reaches the person (the 25 Sept label count)', async () => {
  let n = 0
  const r = await runLoop({ ...base,
    create: async () => n++ === 0
      ? response([{ type: 'text', text: 'Main label: 4,010 in the studio. Cosmo x Cleo: 2,000.', citations: null }, toolUse('update_purchase_order')])
      : response([{ type: 'text', text: 'Also retired the note asking Jane to confirm that number.', citations: null }], 'end_turn'),
    execute: async () => ({ updated: true }),
  })
  assert.match(r.text, /4,010/)
  assert.match(r.text, /Also retired/)
  assert.ok(r.text.indexOf('4,010') < r.text.indexOf('Also retired'), 'kept in the order it was said')
})
