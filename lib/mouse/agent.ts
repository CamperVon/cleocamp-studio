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
}

/** Tools that only look, or that raise something for a human to confirm. */
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
  const client = new Anthropic()
  const maxRounds = opts.maxRounds ?? 6
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

  const writes: AgentWrite[] = []
  const toolCalls: unknown[] = []
  let model = opts.model ?? CHAT_MODEL
  let escalated: string | null = null
  let text = ''

  for (let round = 0; round < maxRounds; round++) {
    const res = await client.messages.create({
      model,
      max_tokens: 16000,
      system,
      tools,
      thinking: { type: 'adaptive' },
      output_config: { effort: opts.effort ?? (model === DEEP_MODEL ? 'high' : 'medium') },
      messages,
    })

    if (res.stop_reason !== 'tool_use') {
      text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n')
      break
    }

    const uses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')

    // Escalation restarts the turn so the whole problem gets the better
    // reasoning, not just whatever comes after the handover.
    const deep = uses.find((u) => u.name === 'request_deep_analysis')
    if (deep && model !== DEEP_MODEL) {
      model = DEEP_MODEL
      escalated = (deep.input as { reason?: string }).reason ?? 'harder than it looked'
      continue
    }

    messages.push({ role: 'assistant', content: res.content })

    // All results in ONE user message — splitting them teaches the model to
    // stop making parallel calls.
    const results: Anthropic.ToolResultBlockParam[] = []
    for (const u of uses) {
      const tool = TOOLS[u.name]
      toolCalls.push({ name: u.name, input: u.input })
      if (!tool || !allowed.includes(u.name)) {
        results.push({
          type: 'tool_result', tool_use_id: u.id, is_error: true,
          content: 'that tool is not available in this context',
        })
        continue
      }
      try {
        const out = await tool.run(u.input)
        if (u.name !== 'query_status' && u.name !== 'request_deep_analysis') {
          writes.push({ tool: u.name, summary: JSON.stringify(out) })
        }
        results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out) })
      } catch (e) {
        // Hand the failure back rather than dropping it — it should say the
        // thing did not work, not carry on as though it had.
        results.push({
          type: 'tool_result', tool_use_id: u.id, is_error: true,
          content: `failed: ${(e as Error).message}`,
        })
      }
    }
    messages.push({ role: 'user', content: results })
  }

  return { text, writes, toolCalls, model, escalated }
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
