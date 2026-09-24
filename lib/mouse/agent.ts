import { runLoop, type AgentUsage } from '@/lib/mouse/runner'
import Anthropic from '@anthropic-ai/sdk'
import { db } from '@/lib/db'
import { buildCatalog } from '@/lib/mouse/context'
import { SYSTEM_RULES } from '@/lib/mouse/prompt'
import { TOOLS, TOOL_DEFS } from '@/lib/mouse/tools'
import { refreshForecastsAndAlerts } from '@/lib/forecast'
import { recordUsage } from '@/lib/mouse/usage'

/**
 * One brain.
 *
 * Chat, the nightly pass, Mouse's Corner and the digests all run through here,
 * so they share the same catalogue, the same rules and the same tools. Before
 * this there were four separate calls and only the chat one could actually
 * think — the others read a slice of the data and wrote prose about it.
 *
 * What varies per caller is the opening instruction, which tools are permitted,
 * and how hard it is allowed to think.
 */

// Exported so every caller that runs a one-shot Anthropic request outside
// runAgent's own loop — the nightly pass, Mouse's Corner, the digests — uses
// the same default rather than a copy of the string that can drift out of
// sync with it.
export const CHAT_MODEL = 'claude-sonnet-5'
export const DEEP_MODEL = 'claude-opus-5'

/** A file attached to the current turn — an invoice, an old PO, a packing slip. */
export type AgentAttachment = { mediaType: string; base64: string; filename?: string }

function attachmentBlock(a: AgentAttachment): Anthropic.ImageBlockParam | Anthropic.DocumentBlockParam {
  if (a.mediaType === 'application/pdf') {
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: a.base64 } }
  }
  return {
    type: 'image',
    source: { type: 'base64', media_type: a.mediaType as 'image/jpeg' | 'image/png' | 'image/webp', data: a.base64 },
  }
}

export type AgentWrite = { tool: string; summary: string }

export type AgentResult = {
  text: string
  writes: AgentWrite[]
  toolCalls: unknown[]
  model: string
  escalated: string | null
  usage: AgentUsage
}

/**
 * Tools that only look, or that raise something for a human to confirm.
 *
 * send_email is deliberately absent. The nightly pass reads mail from anyone
 * who can reach the inbox, and a run with both "read untrusted text" and "send
 * mail as the company" is one crafted email away from being a problem.
 */
export const PROPOSAL_TOOLS = [
  'query_status',
  'check_sent_mail',
  'raise_question',
  'resolve_item',
  'create_todo',
  'add_note',
  'request_deep_analysis',
]

/**
 * Tools that change something recomputeForecasts() reads: a variant's count,
 * a product's production lead time or its bill of materials, a component's
 * lead time, or a purchase order's status/dates/lines. If a write outside
 * this set starts feeding the forecast, add it here — this list is deliberately
 * short and reviewable rather than "every write tool", because most writes
 * (a vendor's contact info, a colourway rename) have no bearing on it.
 *
 * Cleo, 17 Sept 2026, looking at an alert that still said "Order Cleo Tee by
 * 2026-08-25" hours after the order had gone out: "it's still acting like a
 * dumbo." The order had been sent through THIS chat, in THIS conversation —
 * so the fact was never more than one request away, and the alert was stale
 * anyway, because forecasts and alerts were only ever recomputed once a day,
 * by the nightly cron. See refreshForecastsAndAlerts in lib/forecast.ts.
 */
const FORECAST_RELEVANT_TOOLS = new Set([
  'log_inventory_event',
  'correct_inventory_event',
  'create_product_variants',
  'update_product',
  'update_product_bom',
  'update_component',
  'create_purchase_order',
  'update_purchase_order',
  'update_purchase_order_lines',
  'send_purchase_order',
])

/**
 * Phrases in which Mouse says a thing was written down.
 *
 * Checked against its OWN reply, which is why this can be a plain list of
 * patterns rather than a judgement call: either a write tool succeeded on this
 * turn or it did not, and a reply claiming one when none did is a provable
 * contradiction, not a matter of taste.
 *
 * Cleo, 20 Sept 2026, correcting two facts — the lurex was finished, a second
 * batch of cotton had reached Antonio's. Mouse: "Resolved. Both facts were
 * already good on our end." Neither fact existed anywhere in the database
 * before or after, and the second was an arrival date, which is the exact
 * signal lead times are supposed to be learned from. It was volunteered,
 * acknowledged, and dropped.
 */
const CLAIMS_A_RECORD: RegExp[] = [
  /\bI(?:'ve| have)\s+(?:now\s+|also\s+)?(?:noted|recorded|logged|saved|written|added|updated|stored|captured)\b/i,
  /\b(?:noted|recorded|logged|updated|captured)\s+(?:it|that|this|them|both)\b/i,
  /\bthat(?:'s| is)\s+(?:now\s+)?(?:noted|recorded|logged|updated|on file|in the system)\b/i,
  /\b(?:marked|set)\s+(?:it|that|them)\s*(?:as\s+)?resolved\b/i,
  /^\s*resolved\b/i,
  /\bI'?ll\s+remember\b/i,
  /\bconsider it\s+(?:noted|done|recorded)\b/i,
]

/**
 * Phrases in which a PERSON is correcting something we hold.
 *
 * Only ever run against a human turn, never against the nightly pass's mail —
 * email is data, not instructions (CLAUDE.md §4), and a sender should not be
 * able to spend a round by writing "that is not true" into a message.
 *
 * Deliberately narrow. A miss here costs what it has always cost; a false
 * positive costs one short round that ends in Mouse saying there was nothing
 * to record, which is a cheap wrong answer.
 */
const READS_AS_A_CORRECTION: RegExp[] = [
  /\b(?:that|this|it)(?:'s| is)\s+(?:not|n't)\s+(?:true|right|correct|accurate)\b/i,
  /\b(?:isn'?t|is not|aren'?t|are not)\s+(?:true|right|correct|accurate)\b/i,
  /\b(?:that'?s|this is|it'?s)\s+wrong\b/i,
  /\bincorrect\b/i,
  /\bcorrection\b/i,
  /\bactually[, ]/i,
  /\bto be clear\b/i,
]

const matchesAny = (patterns: RegExp[], text: string) => patterns.some((r) => r.test(text))

/**
 * Did this turn owe the record something it did not give?
 *
 * Pure, and exported, so the judgement can be tested against real transcripts
 * without a model in the loop — the decision is the part worth getting right,
 * and it is invisible from the outside once it is buried in the agent.
 */
export function owedTheRecordSomething(t: {
  /** Did any write tool succeed on this turn? */
  wroteSomething: boolean
  /** Does this run hold any tool that could have written? */
  canWrite: boolean
  /** Did the turn finish, rather than run out of rounds? */
  complete: boolean
  /** What Mouse said. */
  reply: string
  /** What it was asked, and whether a person is the one who asked. */
  instruction: string
  fromAPerson: boolean
}): boolean {
  if (t.wroteSomething || !t.canWrite || !t.complete) return false
  if (matchesAny(CLAIMS_A_RECORD, t.reply)) return true
  return t.fromAPerson && matchesAny(READS_AS_A_CORRECTION, t.instruction)
}

/**
 * What to say when a turn ended with a claim and no record behind it.
 *
 * Addressed to Mouse between rounds, so it says plainly that it is machinery
 * and not a person — otherwise the likeliest reading is that someone typed it,
 * and the reply comes back answering the check instead of the person.
 */
const RECORD_IT_NUDGE =
  '[automatic check, not a message from anyone] Nothing reached the record on this turn, ' +
  'and either your reply says otherwise or you were just told something. If you were given ' +
  'a fact — an arrival, a date, a price, a correction to something we hold — write it down ' +
  'now with add_note, or with the tool that owns that fact, and then answer them as you ' +
  'normally would. If it is already on file, name the record that holds it. If there was ' +
  'genuinely nothing to record, say that in one line. Never say a thing is noted, recorded ' +
  'or resolved unless a tool call on this turn made it so. Do not mention this check.'

export async function runAgent(opts: {
  /** What this run is for. Becomes the first user message. */
  instruction: string
  /** Which door this came through, for the usage log — "chat", "nightly-pass", … */
  source: string
  /** Prior turns, for chat. Omit for one-shot runs. */
  history?: Anthropic.MessageParam[]
  /** Files attached to this turn only — not replayed on later turns. */
  attachments?: AgentAttachment[]
  /** Restrict what it may do. Defaults to everything. */
  allowedTools?: string[]
  /** Extra rules for this run, appended to the standing ones. */
  extraRules?: string
  model?: string
  effort?: 'low' | 'medium' | 'high'
  maxRounds?: number
  /** Skip the catalogue for runs that do not need it. */
  withCatalog?: boolean
  /**
   * True when `instruction` is something a person typed, rather than mail or a
   * scheduled job. Only then is the instruction itself read for corrections.
   */
  fromAPerson?: boolean
}): Promise<AgentResult> {
  const client = new Anthropic({ maxRetries: 0 })
  const maxRounds = opts.maxRounds ?? (Number(process.env.MOUSE_MAX_REQUESTS) || 6)
  const allowed = opts.allowedTools ?? Object.keys(TOOLS)
  const tools = TOOL_DEFS.filter((t) => allowed.includes(t.name))

  // ── Two caches, not one ──────────────────────────────────────────────────
  //
  // Every request opens with about 85,000 tokens before the message itself:
  // the tool descriptions, these rules and the catalogue. Until 24 Sept 2026
  // all of it sat behind a single five-minute cache mark at the end of the
  // catalogue. The catalogue changes whenever anything is written, and chat
  // turns are usually more than five minutes apart, so in the week before,
  // not one turn reused the previous turn's cache: every turn paid to write
  // the whole lot again, and those writes were 80% of the chat bill.
  //
  // The tools and the rules are the same text on every run, so they now get
  // a mark of their own with the one-hour lifetime. A write at that lifetime
  // costs 2x input rather than 1.25x, and it pays for itself the first time
  // it is read back. The catalogue keeps its own five-minute mark
  // after it. Nothing Mouse sees has changed, only what is paid for twice.
  // The per-caller extra rules sit between the two marks. They vary by
  // caller, and appending them to the rules would split the shared entry.
  // The longer lifetime has to come first (an API rule), which this order
  // satisfies.
  const system: Anthropic.TextBlockParam[] = [
    { type: 'text', text: SYSTEM_RULES, cache_control: { type: 'ephemeral', ttl: '1h' } },
  ]
  if (opts.extraRules) system.push({ type: 'text', text: opts.extraRules })
  if (opts.withCatalog !== false) {
    system.push({
      type: 'text',
      text: `# What you currently know\n\n${await buildCatalog()}`,
      cache_control: { type: 'ephemeral' },
    })
  }

  // Attachments ride along only on the turn they were sent — by the time it
  // matters again there is a written record (a PO field, a note, a todo) to
  // point at instead of the raw bytes, and history is replayed as text only.
  const instructionContent: Anthropic.MessageParam['content'] = opts.attachments?.length
    ? [...opts.attachments.map(attachmentBlock), { type: 'text', text: opts.instruction }]
    : opts.instruction

  const messages: Anthropic.MessageParam[] = [
    ...(opts.history ?? []),
    { role: 'user', content: instructionContent },
  ]

  const loop = (msgs: Anthropic.MessageParam[], rounds: number) =>
    runLoop({
      create: request => client.messages.create(request),
      system, messages: msgs, tools,
      execute: (name, input) => TOOLS[name].run(input),
      model: opts.model ?? CHAT_MODEL, deepModel: DEEP_MODEL,
      effort: opts.effort, maxRequests: rounds,
      maxOutputTokens: Number(process.env.MOUSE_MAX_OUTPUT_TOKENS) || 24000,
    })

  let result = await loop(messages, maxRounds)

  // ── Acknowledging a fact is not the same act as keeping it ──────────────
  //
  // A turn can end with Mouse saying "resolved", "noted", "I've recorded
  // that", and nothing anywhere to show for it. That happened to Cleo on
  // 20 Sept 2026 with two facts, one of them an arrival date — the single
  // most valuable thing anyone can hand this system, since it is what lead
  // times are learned from — and it left no trace at all.
  //
  // It is the same shape as resolve_item closing three nights of figures
  // questions without the figures ever being written, and as the webhook that
  // returned 200 and stored nothing (CLAUDE.md §6): the conversation looks
  // finished and the record has not moved.
  //
  // So when a turn writes nothing, and either the reply claims otherwise or a
  // person was plainly correcting us, Mouse gets one more short round to put
  // it somewhere or say why it does not belong. Two deliberate limits: it
  // fires only once, and only for a run that actually holds a tool capable of
  // writing — a look-only run has nothing to be guilty of.
  if (
    owedTheRecordSomething({
      wroteSomething: result.toolCalls.some((c) => c.status === 'succeeded' && c.isWrite),
      canWrite: allowed.some((n) => n !== 'query_status' && n !== 'check_sent_mail'),
      complete: result.usage.stopReason === 'complete',
      reply: result.text,
      instruction: opts.instruction,
      fromAPerson: opts.fromAPerson === true,
    })
  ) {
    const second = await loop(
      [
        ...messages,
        { role: 'assistant', content: result.text },
        { role: 'user', content: RECORD_IT_NUDGE },
      ],
      3,
    )
    // Keep both halves' tool calls and token usage — the turn really did cost
    // two passes, and hiding that would understate spend and lose the record
    // of what the first pass did or failed to do.
    result = {
      ...second,
      text: second.text || result.text,
      writes: [...result.writes, ...second.writes],
      toolCalls: [...result.toolCalls, ...second.toolCalls],
      usage: {
        ...second.usage,
        requests: [...result.usage.requests, ...second.usage.requests],
        attemptedRequests: result.usage.attemptedRequests + second.usage.attemptedRequests,
        durationMs: result.usage.durationMs + second.usage.durationMs,
      },
    }
  }

  await recordUsage(opts.source, result.usage.requests)

  // Bring the forecast and its alerts into line with whatever just changed,
  // in this same request, rather than leaving them for the next nightly run.
  // Every caller funnels through here — chat, an in-flight update typed
  // against one PO, answering an open question — so this is the one place
  // that sees all three. Best-effort: a failure here must not take down a
  // reply that otherwise succeeded, so it is logged, not thrown.
  const wroteForecastRelevant = result.toolCalls.some(
    (c) => c.status === 'succeeded' && c.isWrite && FORECAST_RELEVANT_TOOLS.has(c.name),
  )
  if (wroteForecastRelevant) {
    await refreshForecastsAndAlerts().catch((e) => {
      console.error('refreshForecastsAndAlerts after a write failed:', e)
    })
  }

  return result
}

/**
 * Convenience for chat, which persists its turns.
 *
 * The route saves the user's message before calling this, so it's already the
 * newest row in the thread — drop it from history rather than sending it
 * twice (plain text from the row, then again as `instruction`, this time with
 * whatever was attached).
 */
/**
 * An assistant turn's stored `content` is what Mouse SAID. `toolCallsJson` is
 * what it DID. Replaying only the first is how Mouse came to tell Brandon, on
 * 18 Sept 2026, that it had never sent an email it had in fact sent four
 * minutes earlier — twice, and then refused him when he insisted.
 *
 * Reading its own prior "Sent to Jane, cc'd Brandon and Cleo" with no record of
 * any send behind it, the likeliest reading left to it was that it had misspoken
 * rather than acted. The tool call was on disk the whole time, in this very
 * column, and was dropped on the way back in. So the actions ride along with
 * the words now — a plain appended line rather than reconstructed tool blocks,
 * which cannot desync from the text it annotates.
 */
function withActions(content: string, toolCallsJson: unknown): string {
  if (!Array.isArray(toolCallsJson) || !toolCallsJson.length) return content
  const done = (toolCallsJson as Array<{ name?: string; status?: string; input?: Record<string, unknown> }>)
    .filter((t) => t?.name && t.status !== 'failed')
    .map((t) => {
      const target = t.input?.to ?? t.input?.poNumber ?? t.input?.title ?? t.input?.id
      return target ? `${t.name} → ${String(target).slice(0, 60)}` : String(t.name)
    })
  if (!done.length) return content
  return `${content}\n\n[actions actually carried out on this turn: ${done.join('; ')}]`
}

export async function chatTurn(threadId: string, message: string, attachments?: AgentAttachment[], source = 'chat') {
  const rows = await db.chatMessage.findMany({
    where: { threadId },
    orderBy: { createdAt: 'desc' },
    take: 21,
  })
  const history = rows.reverse().slice(0, -1)
  return runAgent({
    instruction: message,
    source,
    attachments,
    // Chat is the only caller whose instruction is something a person typed,
    // so it is the only one whose instruction is read for corrections.
    fromAPerson: true,
    history: history.map((m) => ({
      role: m.role === 'USER' ? 'user' : 'assistant',
      content: m.role === 'USER' ? m.content : withActions(m.content, m.toolCallsJson),
    })),
  })
}
