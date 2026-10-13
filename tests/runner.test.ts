import assert from 'node:assert/strict'
import test from 'node:test'
import { runLoop, requireComplete } from '../lib/mouse/runner'
import { completedWrites, diagnosticValue } from '../lib/mouse/outcomes'
import type Anthropic from '@anthropic-ai/sdk'

const usage = { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 20, cache_creation_input_tokens: 10 } as Anthropic.Usage
const toolUse = (name: string, id = name): Anthropic.ToolUseBlock => ({ type: 'tool_use', caller: { type: 'direct' }, name, id, input: { poNumber: 'TEST-1' } })
const response = (content: Anthropic.ContentBlock[], stop_reason: Anthropic.StopReason = 'tool_use') => ({ content, stop_reason, usage })
const answer = response([{ type: 'text', text: 'Done.', citations: null }], 'end_turn')
const defs: Anthropic.Tool[] = ['update_purchase_order', 'send_purchase_order', 'query_status', 'create_purchase_order']
  .map(name => ({ name, input_schema: { type: 'object' } }))
const base = { system: [], messages: [{ role: 'user' as const, content: 'Prepare my order.' }], tools: defs, model: 'normal' }

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

test('parallel calls each run once and all their results go back in one message', async () => {
  let n = 0, writes = 0
  const r = await runLoop({ ...base,
    create: async req => {
      if (n++ === 0) return response([toolUse('query_status'), toolUse('update_purchase_order')])
      assert.equal((req.messages.at(-1)!.content as unknown[]).length, 2)
      return answer
    }, execute: async (name) => { if (name === 'update_purchase_order') writes++; return { updated: true } },
  })
  assert.equal(writes, 1)
  assert.equal(r.writes.length, 1)
})

test('a draft waiting for a yes is not fed back as an error', async () => {
  let n = 0
  const r = await runLoop({ ...base,
    create: async req => {
      if (n++ === 0) return response([toolUse('send_purchase_order')])
      const last = req.messages.at(-1)!.content as Anthropic.ToolResultBlockParam[]
      assert.equal(last[0].is_error, false)
      return answer
    }, execute: async () => ({ draft: true, sent: false, to: 'vendor@example.com' }),
  })
  assert.equal(r.toolCalls[0].status, 'no_change')
  assert.equal(r.writes.length, 0)
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
    model: 'm',
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

test('a brief 503 from the model is tried once more, and the turn finishes', async () => {
  let n = 0
  const r = await runLoop({ ...base, sleep: async () => {},
    create: async () => { if (n++ === 0) throw Object.assign(new Error('503 status code (no body)'), { status: 503 }); return answer },
    execute: async () => ({}),
  })
  assert.equal(r.usage.stopReason, 'complete')
  assert.equal(r.text, 'Done.')
  assert.equal(r.usage.attemptedRequests, 2)
})

test('a second 503 in the same turn is reported, not retried forever', async () => {
  let n = 0
  const r = await runLoop({ ...base, sleep: async () => {},
    create: async () => { n++; throw Object.assign(new Error('overloaded'), { status: 529 }) },
    execute: async () => ({}),
  })
  assert.equal(r.usage.stopReason, 'provider_error')
  assert.equal(n, 2)
})

test('a safety decline is reported as one, not as running out of reasoning', async () => {
  const r = await runLoop({ ...base,
    create: async () => response([], 'refusal'),
    execute: async () => ({}),
  })
  assert.equal(r.usage.stopReason, 'refusal')
  assert.match(r.text, /safety check declined/)
  assert.doesNotMatch(r.text, /reasoning limit/)
})

test('out of Anthropic credit says so, not "connection failed"', async () => {
  const r = await runLoop({ ...base,
    create: async () => { throw new Error('400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}') },
    execute: async () => ({}),
  })
  assert.equal(r.usage.stopReason, 'provider_error')
  assert.match(r.text, /out of credit/)
  assert.match(r.text, /console\.anthropic\.com/)
  assert.doesNotMatch(r.text, /connection failed/)
})

// Out of rounds mid-work (13 Oct 2026): Jane's stylist and pull were all
// saved in the last two rounds, and she was told only "I reached this
// turn's reasoning limit... please continue from here".
test('out of rounds mid-work: one tools-off request says what was done, instead of the stock sentence', async () => {
  const seen: Array<Record<string, unknown>> = []
  let writes = 0
  const r = await runLoop({ ...base, maxRequests: 2,
    create: async (req) => {
      seen.push(req as never)
      if (seen.length <= 2) return response([{ type: 'text', text: 'Saving the stylist.', citations: null }, toolUse('update_purchase_order', `t${seen.length}`)])
      return response([{ type: 'text', text: 'I added Morgan Lipsen and recorded her pull. I still need the date it comes back.', citations: null }], 'end_turn')
    },
    execute: async () => { writes++; return { updated: true } },
  })
  assert.equal(seen.length, 3, 'the two rounds, then the wrap-up')
  const wrap = seen[2] as { tool_choice?: unknown; tools?: unknown; messages: Anthropic.MessageParam[]; output_config?: { effort?: string } }
  assert.deepEqual(wrap.tool_choice, { type: 'none' })
  assert.equal(wrap.tools, seen[0].tools, 'the same tool list, so the cached prefix is read')
  assert.equal(wrap.output_config?.effort, 'low')
  const lastBlocks = wrap.messages.at(-1)!.content as Array<{ type: string; text?: string }>
  assert.equal(lastBlocks[0].type, 'tool_result')
  assert.match(lastBlocks.at(-1)!.text ?? '', /used all its steps/)
  assert.equal(writes, 2)
  assert.equal(r.writes.length, 2)
  assert.match(r.text, /I added Morgan Lipsen/)
  assert.doesNotMatch(r.text, /reasoning limit|continue from here/)
  assert.equal(r.usage.stopReason, 'budget', 'still an unfinished turn: logged, and refused by background callers')
  assert.throws(() => requireComplete(r))
  assert.equal(r.usage.requests.length, 3)
  assert.equal(r.usage.requests[2].effort, 'low')
})

test('out of rounds: if the wrap-up fails or calls a tool anyway, the stock sentence stands and nothing more runs', async () => {
  let executed = 0
  const failing = await runLoop({ ...base, maxRequests: 1,
    create: (() => { let n = 0; return async () => { if (n++ === 0) return response([toolUse('update_purchase_order')]); throw new Error('offline') } })(),
    execute: async () => { executed++; return { updated: true } },
  })
  assert.match(failing.text, /1 action completed/)
  assert.equal(failing.usage.attemptedRequests, 2)
  executed = 0
  const ignoring = await runLoop({ ...base, maxRequests: 1,
    create: async () => response([toolUse('update_purchase_order')]),
    execute: async () => { executed++; return { updated: true } },
  })
  assert.equal(executed, 1, 'the tool call in the wrap-up is never run')
  assert.match(ignoring.text, /1 action completed/)
})

test('no wrap-up when the turn finished, or when nothing was attempted', async () => {
  let n = 0
  const done = await runLoop({ ...base, maxRequests: 2,
    create: async () => n++ === 0 ? response([toolUse('query_status')]) : answer,
    execute: async () => ({ found: [] }),
  })
  assert.equal(n, 2)
  assert.equal(done.text, 'Done.')
  let m = 0
  const offline = await runLoop({ ...base, create: async () => { m++; throw new Error('offline') }, execute: async () => ({}) })
  assert.equal(m, 1, 'a failed connection gets no extra request')
  assert.match(offline.text, /connection failed/)
})
