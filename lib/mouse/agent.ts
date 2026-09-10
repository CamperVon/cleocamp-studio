import { runLoop, type AgentUsage } from '@/lib/mouse/runner'
import Anthropic from '@anthropic-ai/sdk'
import { db } from '@/lib/db'
import { buildCatalog } from '@/lib/mouse/context'
import { SYSTEM_RULES } from '@/lib/mouse/prompt'
import { TOOLS, TOOL_DEFS } from '@/lib/mouse/tools'

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

const CHAT_MODEL = 'claude-sonnet-5'
const DEEP_MODEL = 'claude-opus-5'

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
  'raise_question',
  'resolve_question',
  'create_todo',
  'add_note',
  'request_deep_analysis',
]

export async function runAgent(opts: {
  /** What this run is for. Becomes the first user message. */
  instruction: string
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
}): Promise<AgentResult> {
  const client = new Anthropic({ maxRetries: 0 })
  const maxRounds = opts.maxRounds ?? (Number(process.env.MOUSE_MAX_REQUESTS) || 6)
  const allowed = opts.allowedTools ?? Object.keys(TOOLS)
  const tools = TOOL_DEFS.filter((t) => allowed.includes(t.name))

  const system: Anthropic.TextBlockParam[] = [
    { type: 'text', text: SYSTEM_RULES + (opts.extraRules ? `\n\n${opts.extraRules}` : '') },
  ]
  if (opts.withCatalog !== false) {
    // Cached — it is the expensive part and barely changes between runs.
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

  return runLoop({
    create: request => client.messages.create(request),
    system, messages, tools,
    execute: (name, input) => TOOLS[name].run(input),
    model: opts.model ?? CHAT_MODEL, deepModel: DEEP_MODEL,
    effort: opts.effort, maxRequests: maxRounds,
    maxOutputTokens: Number(process.env.MOUSE_MAX_OUTPUT_TOKENS) || 24000,
  })
}

/**
 * Convenience for chat, which persists its turns.
 *
 * The route saves the user's message before calling this, so it's already the
 * newest row in the thread — drop it from history rather than sending it
 * twice (plain text from the row, then again as `instruction`, this time with
 * whatever was attached).
 */
export async function chatTurn(threadId: string, message: string, attachments?: AgentAttachment[]) {
  const rows = await db.chatMessage.findMany({
    where: { threadId },
    orderBy: { createdAt: 'desc' },
    take: 21,
  })
  const history = rows.reverse().slice(0, -1)
  return runAgent({
    instruction: message,
    attachments,
    history: history.map((m) => ({
      role: m.role === 'USER' ? 'user' : 'assistant',
      content: m.content,
    })),
  })
}
