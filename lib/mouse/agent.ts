import { runLoop, type AgentUsage, type TurnRoute } from '@/lib/mouse/runner'
import { classifyResult } from '@/lib/mouse/outcomes'
import Anthropic from '@anthropic-ai/sdk'
import { db } from '@/lib/db'
import { buildCatalogParts, catalogStats, type CatalogStats } from '@/lib/mouse/context'
import { systemBlocks } from '@/lib/mouse/cache-blocks'
import { SYSTEM_RULES } from '@/lib/mouse/prompt'
import { TOOLS, TOOL_DEFS, type ToolContext } from '@/lib/mouse/tools'
import { refreshForecastsAndAlerts } from '@/lib/forecast'
import { recordUsage } from '@/lib/mouse/usage'
import { withNotesOnWhatChanged } from '@/lib/mouse/stale-notes'

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
// Opus 5.5 throughout (Brandon, 2 Oct 2026: "Can Mouse be more Opus 5.5 and
// not so idiot Claude of old"). Agent runs default to high effort.
export const CHAT_MODEL = 'claude-opus-5-5'
export const DEEP_MODEL = 'claude-opus-5-5'
// The jobs nobody is waiting on: support triage and drafts, the nightly mail
// pass, the brief, digest, tidy and the customer check (Brandon, 3 Oct 2026,
// on cost). Code or a person checks all of their work before anything
// happens. Chat, team email and the AM report stay on CHAT_MODEL/DEEP_MODEL.
// Sonnet 5.5's safety check declines more kinds of text than Opus 5.5's, so
// the runs that read outside mail retry on CHAT_MODEL when it does.
export const BACKGROUND_MODEL = 'claude-sonnet-5-5'

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
  'shopify_analytics',
  'raise_question',
  'flag_for_brandon',
  'resolve_item',
  'create_todo',
  'update_todo',
  'add_note',
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
/**
 * A product or colour that just went on sale joins the wholesale line sheet
 * in the same step, and what it cannot print without comes back with the
 * tool's result, so Mouse asks for it (with the app's suggested price) in the
 * same reply rather than leaving it in ToDo (Brandon, 4 Oct 2026: "mouse
 * should ask us wholesale price (and recommend one) when we add a new
 * product"). The question is in ToDo too, in case the reply is not answered.
 */
async function withLineSheetQuestions(name: string, result: unknown): Promise<unknown> {
  const r = await result
  if (!LINE_SHEET_TOOLS.has(name) || !r || typeof r !== 'object' || classifyResult(name, r).status !== 'succeeded') return r
  try {
    const { lineSheetCatchUp } = await import('@/lib/line-sheet')
    const { added, asked } = await lineSheetCatchUp()
    if (!added.length) return r
    return {
      ...r,
      lineSheet: {
        added: added.map((a) => (a.colorway ? `${a.item} (${a.colorway})` : a.item)),
        ...(asked.length ? { askNow: asked.map((a) => a.detail), note: 'Ask for these in your reply, with the suggested price as given. Set nothing until they answer.' } : {}),
      },
    }
  } catch (e) {
    console.error('line sheet catch-up after a write failed:', e)
    return r
  }
}

/** Tools that can put a product or colour on sale, and so on the line sheet. */
const LINE_SHEET_TOOLS = new Set([
  'create_product', 'update_product', 'create_product_variants', 'create_colorway',
  'update_colorway', 'import_from_shopify', 'sync_shopify',
])

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
const FORGED_ACTIONS = /\[(?:actions actually carried out on this turn:|Record kept by the app)[^\]]*\]/i

/** Remove any copy of the old actions line from what Mouse itself wrote (see actionsCarriedOut). */
export function stripForgedActions(text: string): string {
  return text.replace(new RegExp(`\\s*${FORGED_ACTIONS.source}`, 'gi'), '').trimEnd()
}

const CLAIMS_A_RECORD: RegExp[] = [
  /\bI(?:'ve| have)\s+(?:now\s+|also\s+)?(?:noted|recorded|logged|saved|written|added|updated|stored|captured)\b/i,
  /\b(?:noted|recorded|logged|updated|captured)\s+(?:it|that|this|them|both)\b/i,
  /\bthat(?:'s| is)\s+(?:now\s+)?(?:noted|recorded|logged|updated|on file|in the system)\b/i,
  /\b(?:marked|set)\s+(?:it|that|them)\s*(?:as\s+)?resolved\b/i,
  /^\s*resolved\b/i,
  /\bI'?ll\s+remember\b/i,
  /\bconsider it\s+(?:noted|done|recorded)\b/i,
  // Brandon, 24 Sept 2026: "You missed tissue/newsprint." Mouse: "Fair — … Fixed
  // the todo." No tool had run and no todo mentioned newsprint.
  /\b(?:fixed|corrected|amended)\s+(?:it|that|this|them|the\s+\w+)\b/i,
  /\bI(?:'ve| have)\s+(?:now\s+|also\s+)?(?:fixed|corrected|amended)\b/i,
  // Same turn: it ended its reply with the actions line the app used to append, having
  // copied the shape from its own history. That line is code's to write; a
  // reply carrying one is claiming a record by forging the receipt.
  FORGED_ACTIONS,
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
  /\byou (?:missed|forgot|left (?:out|off))\b/i,
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

const STOCK_TOOLS = new Set(['log_inventory_event', 'correct_inventory_event', 'transfer_component_stock'])

/**
 * The stock changes a turn made, one plain line each: item, change, before
 * and after. Pure, so it can be tested; used for the check below.
 */
export function stockChangesThisTurn(calls: Array<{ name: string; status: string; input?: unknown; result?: unknown }>): string[] {
  return calls
    .filter((c) => STOCK_TOOLS.has(c.name) && c.status === 'succeeded')
    .map((c) => {
      const i = (c.input ?? {}) as Record<string, unknown>
      const r = (c.result ?? {}) as Record<string, unknown>
      const name = typeof r.name === 'string' ? r.name : String(i.componentId ?? i.productVariantId ?? 'an item')
      const after = r.newQty
      const delta = typeof i.deltaQty === 'number' ? i.deltaQty : null
      const change = i.countedQty !== undefined
        ? `counted ${i.countedQty}`
        : c.name === 'correct_inventory_event'
          ? `reversed event ${String(i.eventId ?? '')}`
          : `${String(i.type ?? '')} ${delta !== null && delta > 0 ? '+' : ''}${delta ?? ''}`.trim()
      const before = delta !== null && typeof after === 'number' ? after - delta : null
      return `- ${name}: ${change}${before !== null ? `, was ${before}, now ${after}` : after !== undefined ? `, now ${after}` : ''}${r.shopify ? ` (${String(r.shopify)})` : ''}`
    })
}

/**
 * Brandon, 25 Sept 2026, after Mouse logged the same 8 bean bags twice: "mouse
 * needs to think a bit more and catch its own mistakes … Logging twice is dumb
 * and can't fly here." Any turn from a person that changed stock gets one
 * short round to look at what it just did, before the answer goes out. The
 * duplicate itself is also refused in code (lib/inventory-duplicate.ts); this
 * catches the rest: wrong item, wrong quantity, a count that doesn't match
 * what was said.
 */
const STOCK_CHECK = (lines: string[]) =>
  '[automatic check, not a message from anyone] You changed stock on this turn:\n' +
  lines.join('\n') +
  '\n\nBefore you answer, check each line against what the person actually said: the right ' +
  'item, the right quantity, the right direction, logged once, and not something already ' +
  'recorded on an earlier turn (read the app\'s record of actions after your earlier replies). If a line is ' +
  'wrong, fix it now with correct_inventory_event and say plainly what you corrected. If they ' +
  'are all right, give your answer, stating each change as before → after. Do not mention this check.'

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
   * How the catalogue shows notes: 'full' (default) every note, 'index' one
   * line per subject with full notes via open_record (chat, phase 2A).
   */
  notes?: 'full' | 'index'
  /**
   * How the catalogue shows products and components: 'full' (default) every
   * line, 'index' the chat index with the rest via open_record or prefetch
   * (phase 2B, chat only, behind MOUSE_CATALOG_INDEX).
   */
  catalog?: 'full' | 'index'
  /**
   * Records the message names exactly, looked up by code, with their notes in
   * full (lib/mouse/records.ts prefetchForMessage). Sent as its own block
   * after the person's words; never part of `instruction`, so the correction
   * check and the log read only what the person said.
   */
  prefetch?: string | null
  /**
   * True when `instruction` is something a person typed, rather than mail or a
   * scheduled job. Only then is the instruction itself read for corrections.
   */
  fromAPerson?: boolean
  /**
   * A practice conversation (training Jane and Cleo, 30 Sept 2026): Mouse
   * reads the real records, but nothing that would change anything runs.
   */
  practice?: boolean
  /** The chat thread, set by chatTurn only. Chat-only tools need it. */
  chatThreadId?: string
  /** "read": the read lane (lib/mouse/route.ts). Look-up tools only, enforced three times over. */
  lane?: 'read'
}): Promise<AgentResult> {
  const client = new Anthropic({ maxRetries: 0 })
  const maxRounds = opts.maxRounds ?? (Number(process.env.MOUSE_MAX_REQUESTS) || 6)
  const allowed = toolsFor(opts.allowedTools, opts.chatThreadId, opts.lane)
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
  //
  // 6 Oct 2026: the catalogue is now two blocks. The sections that rarely
  // change (places, vendors, wholesale stores, people, printed-document
  // defaults) sit under a one-hour mark; everything else, notes included,
  // under the five-minute one. Same sections, same text, stable ones first.
  // Layout and the API rules it depends on: lib/mouse/cache-blocks.ts.
  const parts = opts.withCatalog !== false ? await buildCatalogParts({ notes: opts.notes ?? 'full', catalog: opts.catalog ?? 'full' }) : null
  const contextStats: CatalogStats | null = parts ? catalogStats(parts) : null
  const system: Anthropic.TextBlockParam[] = systemBlocks({
    rules: SYSTEM_RULES,
    extraRules: opts.extraRules,
    practiceRules: opts.practice ? PRACTICE_RULES : null,
    catalog: parts,
  })

  // Attachments ride along on the turn they were sent. Chat also replays the
  // files from its last two file-bearing messages (see chatTurn), so a
  // follow-up about the same document can still read it.
  const instructionContent = turnContent(opts.instruction, (opts.attachments ?? []).map(attachmentBlock), opts.prefetch)

  const messages: Anthropic.MessageParam[] = [
    ...(opts.history ?? []),
    { role: 'user', content: instructionContent },
  ]

  const loop = (msgs: Anthropic.MessageParam[], rounds: number) =>
    runLoop({
      // fallbacks "default": if a safety classifier declines, the request is
      // re-run on the model Anthropic recommends for that case, in the same
      // call, rather than the turn simply stopping. If the API ever refuses
      // the option itself, the request goes again without it: a lost
      // fallback must never cost the whole reply.
      create: async request => {
        try {
          return await client.beta.messages.create({
            ...(request as Anthropic.Beta.MessageCreateParamsNonStreaming),
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
          }) as unknown as Anthropic.Message
        } catch (e) {
          if (e instanceof Anthropic.BadRequestError && /fallback/i.test(e.message)) {
            console.error('fallbacks refused; sending without', e.message)
            return client.messages.create(request)
          }
          throw e
        }
      },
      system, messages: msgs, tools,
      execute: async (name, input) => {
        readLaneGuard(opts.lane, name)
        return practiceStop(opts.practice === true, name, input) ??
          withLineSheetQuestions(name, withNotesOnWhatChanged(name, input, await TOOLS[name].run(input, toolContextFor(opts))))
      },
      model: opts.model ?? CHAT_MODEL,
      effort: opts.effort ?? 'high', maxRequests: rounds,
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
    !opts.practice && opts.lane !== 'read' &&
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
        { role: 'assistant', content: stripForgedActions(result.text) },
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

  const changed = opts.fromAPerson === true && opts.lane !== 'read' && result.usage.stopReason === 'complete'
    ? stockChangesThisTurn(result.toolCalls)
    : []
  if (changed.length) {
    const checked = await loop(
      [
        ...messages,
        { role: 'assistant', content: stripForgedActions(result.text) || '(changes made)' },
        { role: 'user', content: STOCK_CHECK(changed) },
      ],
      3,
    )
    result = {
      ...checked,
      text: checked.text || result.text,
      writes: [...result.writes, ...checked.writes],
      toolCalls: [...result.toolCalls, ...checked.toolCalls],
      usage: {
        ...checked.usage,
        requests: [...result.usage.requests, ...checked.usage.requests],
        attemptedRequests: result.usage.attemptedRequests + checked.usage.attemptedRequests,
        durationMs: result.usage.durationMs + checked.usage.durationMs,
      },
    }
  }

  // Whatever the check decided, a forged actions line never reaches the
  // person or the saved turn — it would be replayed as proof next time.
  result = { ...result, text: stripForgedActions(result.text) }

  await recordUsage(opts.source, result.usage.requests)
  // Section sizes and block hashes ride on the usage record (saved with a
  // chat reply as agentUsageJson). Sizes only: no business text.
  if (contextStats) result = { ...result, usage: { ...result.usage, context: contextStats } }

  // The troubleshooting log: every failed or refused tool call and every
  // unfinished turn, written by code whatever the reply says (Brandon,
  // 6 Oct 2026). Practice runs change nothing and are not logged.
  // A read-lane attempt being handed to Opus is not a failure to log: the
  // Opus turn that follows logs its own.
  if (!opts.practice && !(opts.lane === 'read' && whyOpus(result))) {
    const { issuesFrom, logIssues } = await import('@/lib/mouse/issues')
    const { isOutOfCredit, warnOutOfCredit } = await import('@/lib/mouse/credit')
    if (result.usage.stopReason === 'provider_error' && isOutOfCredit(result.usage.providerError)) await warnOutOfCredit(opts.source)
    await logIssues(opts.source, opts.fromAPerson ? opts.instruction : null, issuesFrom({ toolCalls: result.toolCalls, stopReason: result.usage.stopReason, providerError: result.usage.providerError }))
  }

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
 * Tools only an interactive chat turn gets. keep_file picks a file sent in
 * the chat thread it was called from, so a run with no thread (the nightly
 * pass, team email, an in-flight update, answering a to-do) never has it,
 * even when it otherwise takes the whole tool set.
 */
export const CHAT_ONLY_TOOLS = new Set(['keep_file'])

/** The tools a run may use. Pure. */
/**
 * The run context every tool call gets. catalogIndex only for a chat turn
 * (it alone has a thread) whose catalogue is the phase 2B index; any other
 * run, however MOUSE_CATALOG_INDEX is set, reads records as before. Pure.
 */
export function toolContextFor(opts: { chatThreadId?: string; catalog?: 'full' | 'index' }): ToolContext {
  return opts.chatThreadId && opts.catalog === 'index'
    ? { threadId: opts.chatThreadId, catalogIndex: true }
    : { threadId: opts.chatThreadId }
}

export function toolsFor(allowedTools: string[] | undefined, chatThreadId: string | undefined, lane?: 'read'): string[] {
  const all = allowedTools ?? Object.keys(TOOLS)
  const allowed = chatThreadId ? all : all.filter((n) => !CHAT_ONLY_TOOLS.has(n))
  return lane === 'read' ? allowed.filter((n) => READ_LANE_TOOLS.has(n)) : allowed
}

/**
 * The read lane's whole tool set (approved 7 Oct 2026). Look-ups only: no
 * note_problem (it writes the troubleshooting log), nothing that writes,
 * sends, records or changes a thing.
 *
 * The lane must never make Mouse dumber (Brandon, 8 Oct 2026: "either these
 * things are added or it switches to higher model"). So every look-up tool
 * is either here or in READ_LANE_LEAVES_TO_OPUS, a question needing one of
 * those goes to Opus, and an answer that says it can't is handed to Opus
 * too (whyOpus). tests/read-lane.test.ts fails on a look-up tool in neither.
 */
export const READ_LANE_TOOLS = new Set([
  'open_record', 'query_status', 'check_sent_mail', 'search_chat', 'find_in_shopify', 'find_customer',
  'find_contacts', 'reorder_math', 'shopify_analytics', 'unpaid_live_sales', 'shipped_orders',
])

/** Look-up tools the read lane does not hold; a question needing one goes to Opus (READ_LANE_RULES). */
export const READ_LANE_LEAVES_TO_OPUS = new Set([
  // Reading a PDF or photo stays with Opus (7 Oct 2026).
  'read_file',
  // Draft-order links, kept with Opus since the lane was approved.
  'draft_order_links',
])

/** The third lock: in the read lane, a tool outside READ_LANE_TOOLS throws before it runs. */
export function readLaneGuard(lane: 'read' | undefined, name: string): null {
  if (lane === 'read' && !READ_LANE_TOOLS.has(name)) throw new Error(`${name} is not available in the read lane.`)
  return null
}

export const READ_LANE_MODEL = BACKGROUND_MODEL
export const READ_LANE_EFFORT = 'medium' as const
export const OPUS_ESCALATE = '[[OPUS]]'

const READ_LANE_RULES =
  'THIS TURN: you can only look things up. If the person wants anything changed, recorded, sent, ordered ' +
  'or written down, if they are telling you a fact rather than asking, if a file needs reading, if a draft ' +
  'order link is wanted, if you cannot fully answer with the tools you have here, or if you are unsure, reply ' +
  `with exactly ${OPUS_ESCALATE} and nothing else. Never tell the person you can't do something or have no way ` +
  'to: hand it over instead. Otherwise answer the question plainly from what you know and can look up.'

/**
 * Why a read-lane attempt must be handed to Opus, or null if its answer
 * stands: it asked for Opus, stopped early, was declined, failed a tool, or
 * said nothing. Pure.
 */
export function whyOpus(r: Pick<AgentResult, 'text' | 'toolCalls' | 'usage'>): string | null {
  if (r.text.includes(OPUS_ESCALATE)) return 'asked-for-opus'
  if (r.usage.stopReason !== 'complete') return `stopped:${r.usage.stopReason}`
  if ((r.toolCalls as Array<{ status?: string }>).some((c) => c.status === 'failed')) return 'tool-failed'
  if (!r.text.trim()) return 'empty'
  // The backstop for "never dumber": an answer that says it can't is not an
  // answer. Over-matching only costs an Opus turn.
  if (SAYS_IT_CANT.test(r.text)) return 'could-not-answer'
  return null
}

const SAYS_IT_CANT = new RegExp([
  "\\bI\\s+(?:can(?:no|['\u2019])t|cannot|am unable|['\u2019]m unable|am not able|['\u2019]m not able|have no (?:way|tool|access))\\b",
  "\\bI\\s+do(?:n['\u2019]t| not) have (?:a |any )?(?:way|tool|access)",
  '\\bthere(?:\'s| is) no (?:tool|way for me)\\b',
  '\\bno tool (?:here |that )?(?:to|for|can)\\b',
].join('|'), 'i')

/**
 * Run a read-lane attempt and, if it must be handed over, the Opus turn. Only
 * one reply comes back: the attempt's own when it stands, otherwise Opus's,
 * whole, with the attempt kept solely as cost in usage.route. Nothing the
 * attempt said or did is shown or saved as Mouse's reply.
 */
export async function readLaneTurn(reason: string, read: () => Promise<AgentResult>, opus: () => Promise<AgentResult>): Promise<AgentResult> {
  const attempt = await read()
  const because = whyOpus(attempt)
  if (!because) {
    return { ...attempt, usage: { ...attempt.usage, route: { lane: 'read', reason, model: attempt.model, effort: READ_LANE_EFFORT } } }
  }
  const r = await opus()
  const route: TurnRoute = {
    lane: 'read', reason, model: r.model, effort: 'high', escalated: true, escalatedBecause: because,
    attempt: {
      model: attempt.model, stopReason: attempt.usage.stopReason, requests: attempt.usage.requests, durationMs: attempt.usage.durationMs,
      tools: (attempt.toolCalls as Array<{ name?: string }>).map((c) => String(c.name)),
    },
  }
  return { ...r, usage: { ...r.usage, route } }
}

/**
 * Practice mode. Only these run; they look things up and change nothing (the
 * same look-up-only set the team's emailed questions get, see nightly-pass).
 * Everything else is answered with what it would have done.
 */
export const PRACTICE_TOOLS = new Set(['open_record', 'read_file', 'query_status', 'check_sent_mail', 'search_chat', 'draft_order_links', 'unpaid_live_sales', 'find_in_shopify', 'find_contacts', 'find_customer', 'reorder_math', 'shopify_analytics', 'shipped_orders'])

/** In practice, what a tool that would change something hands back instead of running. Null means run it. Pure. */
export function practiceStop(practice: boolean, name: string, input: unknown) {
  if (!practice || PRACTICE_TOOLS.has(name)) return null
  return { skipped: 'practice', wouldHave: { tool: name, input }, note: 'Practice conversation: this was NOT done. Tell the person what you would have done.' }
}

const PRACTICE_RULES = `# PRACTICE CONVERSATION

This is a practice conversation: someone is learning how to use you. The
records you see are real, and questions get real answers. But nothing you do
here is kept: every tool that would change something (stock, notes, to-dos,
orders, emails, Shopify) is stopped before it runs and hands back what it
would have done.

So behave exactly as you would for real, including asking when something is
missing or unclear, and then say plainly what you WOULD have done, starting
with "Practice:". For example: "Practice: I'd have added the to-do *Order more
Boy Belts in Small*." Never say something was done, saved, sent or updated.`

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
 * the words now, as a plain line rather than reconstructed tool blocks.
 *
 * The line goes in a user message straight after the reply, not inside it.
 * Written into Mouse's own replies, it taught Mouse to write the line itself
 * (see stripForgedActions): every earlier reply it read ended that way.
 */
/**
 * The ids a tool result handed back (a store, a draft, a pull, a request, a
 * PO), as "Waymo Commercial [cmuv…]; draft D41 [gid://…]". Pure.
 */
export function madeRefs(r: Record<string, unknown> | undefined): string {
  if (!r || typeof r !== 'object') return ''
  const out: string[] = []
  const nameOf = (o: Record<string, unknown>) => (typeof o.name === 'string' ? o.name : typeof o.title === 'string' ? o.title : '')
  if (typeof r.id === 'string') out.push(`${nameOf(r) || 'id'} [${r.id}]`)
  for (const [k, v] of Object.entries(r)) {
    if (k === 'id') continue
    if (/^(draftOrderId|pullId|requestId|stylistId|wholesaleAccountId|accountId|poNumber|productId|draft)$/.test(k) && (typeof v === 'string' || typeof v === 'number')) out.push(`${k} ${v}`)
    else if (v && typeof v === 'object' && !Array.isArray(v) && typeof (v as Record<string, unknown>).id === 'string') {
      const o = v as Record<string, unknown>
      out.push(`${nameOf(o) || k} [${o.id}]`)
    }
  }
  return out.slice(0, 6).join('; ')
}

function actionsCarriedOut(toolCallsJson: unknown): string | null {
  if (!Array.isArray(toolCallsJson) || !toolCallsJson.length) return null
  const done = (toolCallsJson as Array<{ name?: string; status?: string; input?: Record<string, unknown>; result?: Record<string, unknown> }>)
    // A practice turn's stopped calls did nothing; replaying them as "carried
    // out" would teach Mouse that they happened.
    .filter((t) => t?.name && t.status !== 'failed' && t.result?.skipped !== 'practice')
    .map((t) => {
      // A stock change is spelled out in full: item, change, new count and
      // where it was pushed. "log_inventory_event" alone was too thin to
      // trust — on 25 Sept 2026 Mouse, asked "Meaning you updated Shopify?",
      // decided it had not and logged the same 8 bean bags a second time.
      const r = t.result
      if (r && typeof r.name === 'string' && r.newQty !== undefined) {
        const delta = t.input?.countedQty !== undefined ? `counted ${t.input.countedQty}` : `${t.input?.type ?? ''} ${Number(t.input?.deltaQty) > 0 ? '+' : ''}${t.input?.deltaQty ?? ''}`
        return `${t.name} → ${r.name}: ${delta.trim()}, now ${r.newQty}${r.shopify ? `, ${String(r.shopify).slice(0, 60)}` : ''}`
      }
      const target = t.input?.to ?? t.input?.poNumber ?? t.input?.title ?? t.input?.id
      // What the call made or found, by name AND reference, so the next turn can
      // act on it. Brandon, 5 Oct 2026, "it needs to have better memory":
      // Mouse made the Waymo Commercial store, then could not invoice it one
      // message later because the store's id was gone from what it was shown.
      const refs = madeRefs(r)
      const head = target ? `${t.name} → ${String(target).slice(0, 60)}` : String(t.name)
      return refs ? `${head} (${refs})` : head
    })
  if (!done.length) return null
  return `[Record kept by the app, not a message from anyone: your reply above carried out ${done.join('; ')}]`
}

/**
 * The person's turn as sent: any files, their words, then (separately) what
 * code looked up for it. A plain string when there is nothing else, as
 * before. Pure.
 */
export function turnContent(
  instruction: string,
  files: Array<Anthropic.ImageBlockParam | Anthropic.DocumentBlockParam>,
  prefetch?: string | null,
): Anthropic.MessageParam['content'] {
  if (!files.length && !prefetch) return instruction
  return [...files, { type: 'text', text: instruction }, ...(prefetch ? [{ type: 'text' as const, text: prefetch }] : [])]
}

export async function chatTurn(threadId: string, message: string, attachments?: AgentAttachment[], source = 'chat', practice = false) {
  const rows = await db.chatMessage.findMany({
    where: { threadId },
    orderBy: { createdAt: 'desc' },
    take: 21,
    include: { attachments: { select: { mediaType: true, data: true, filename: true } } },
  })
  const history = rows.reverse().slice(0, -1)
  // The files from the last two messages that had any ride along again, so a
  // follow-up can still read them. Until 29 Sept 2026 a file was seen on its
  // own turn only: Brandon sent the Grandpa pop-up sheet, then answered
  // Mouse's question about which tee "Aqua" was, and Mouse replied "I don't
  // actually have the sheet's numbers in front of me — can you read those off
  // for me?" Older files are left out to keep each turn a sensible size.
  const withFiles = new Set(history.filter((m) => m.role === 'USER' && m.attachments.length).slice(-2).map((m) => m.id))
  // Phase 2A (6 Oct 2026): chat reads notes as an index, and the records
  // this message names exactly come with their notes already looked up.
  // Phase 2B (8 Oct 2026, MOUSE_CATALOG_INDEX, off by default): products and
  // components as an index too, and a named one prefetched whole.
  const { prefetchForMessage } = await import('@/lib/mouse/records')
  const { catalogIndexOn } = await import('@/lib/mouse/context')
  const catalogIndex = catalogIndexOn()
  const prefetch = await prefetchForMessage(message, { catalogue: catalogIndex })
  const base: Parameters<typeof runAgent>[0] = {
    instruction: message,
    source,
    attachments,
    notes: 'index',
    catalog: catalogIndex ? 'index' : 'full',
    prefetch,
    // Chat is the only caller whose instruction is something a person typed,
    // so it is the only one whose instruction is read for corrections.
    fromAPerson: true,
    practice,
    chatThreadId: threadId,
    // Consecutive user messages are joined by the API, so the record of a
    // reply's actions reads as the opening of the next person's message.
    history: history.flatMap((m): Anthropic.MessageParam[] => {
      if (m.role !== 'USER') {
        const actions = actionsCarriedOut(m.toolCallsJson)
        return [
          { role: 'assistant', content: stripForgedActions(m.content) },
          ...(actions ? [{ role: 'user' as const, content: actions }] : []),
        ]
      }
      return [{
        role: 'user',
        content: withFiles.has(m.id)
          ? [
              ...m.attachments.filter((a) => a.data).map((a) => attachmentBlock({ mediaType: a.mediaType, base64: a.data! })),
              { type: 'text', text: m.content },
            ]
          : m.content,
      }]
    }),
  }
  const opus = () => runAgent(base)

  // The read lane (approved 7 Oct 2026, MOUSE_READ_LANE, off by default):
  // a plain look-up question may go to Sonnet with look-up tools only, and
  // anything else, or any doubt, is today's Opus turn exactly as it was.
  const { routeChat } = await import('@/lib/mouse/route')
  const lastReply = [...history].reverse().find((m) => m.role !== 'USER')?.content ?? null
  const route = routeChat(message, {
    enabled: process.env.MOUSE_READ_LANE === '1',
    source, practice,
    hasAttachments: (attachments?.length ?? 0) > 0,
    filesInHistory: withFiles.size > 0,
    lastReply,
  })
  if (route.lane === 'read') {
    return readLaneTurn(route.reason,
      () => runAgent({ ...base, model: READ_LANE_MODEL, effort: READ_LANE_EFFORT, lane: 'read', extraRules: READ_LANE_RULES }),
      opus)
  }
  const r = await opus()
  return { ...r, usage: { ...r.usage, route: { lane: 'opus' as const, reason: route.reason, model: r.model, effort: 'high' as const } } }
}
