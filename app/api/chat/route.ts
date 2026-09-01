import { NextResponse, type NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { db } from '@/lib/db'
import { buildCatalog } from '@/lib/mouse/context'
import { SYSTEM_RULES } from '@/lib/mouse/prompt'
import { TOOLS, TOOL_DEFS } from '@/lib/mouse/tools'

const CHAT_MODEL = 'claude-sonnet-5'
const DEEP_MODEL = 'claude-opus-5'
const MAX_ROUNDS = 6

const client = new Anthropic()

type Write = { tool: string; summary: string }

export async function POST(req: NextRequest) {
  const { threadId, message } = (await req.json()) as { threadId?: string; message: string }
  if (!message?.trim()) return NextResponse.json({ error: 'empty message' }, { status: 400 })

  const thread = threadId
    ? await db.chatThread.findUnique({ where: { id: threadId } })
    : await db.chatThread.create({ data: {} })
  if (!thread) return NextResponse.json({ error: 'no such thread' }, { status: 404 })

  const history = await db.chatMessage.findMany({
    where: { threadId: thread.id },
    orderBy: { createdAt: 'desc' },
    take: 20,
  })

  const messages: Anthropic.MessageParam[] = history
    .reverse()
    .map((m) => ({ role: m.role === 'USER' ? 'user' : 'assistant', content: m.content }))
  messages.push({ role: 'user', content: message })

  const userRow = await db.chatMessage.create({
    data: { threadId: thread.id, role: 'USER', content: message },
  })

  // Render order is tools -> system -> messages, so the cache breakpoint goes on
  // the last system block. The catalogue is the expensive part and is stable
  // between turns, so it is served at a tenth of the input rate after turn one.
  const catalog = await buildCatalog()
  const system: Anthropic.TextBlockParam[] = [
    { type: 'text', text: SYSTEM_RULES },
    {
      type: 'text',
      text: `# What you currently know\n\n${catalog}`,
      cache_control: { type: 'ephemeral' },
    },
  ]

  const writes: Write[] = []
  const toolCalls: unknown[] = []
  let model = CHAT_MODEL
  let escalated: string | null = null
  let reply = ''

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = await client.messages.create({
      model,
      max_tokens: 16000,
      system,
      tools: TOOL_DEFS,
      thinking: { type: 'adaptive' },
      output_config: { effort: model === DEEP_MODEL ? 'high' : 'medium' },
      messages,
    })

    if (res.stop_reason !== 'tool_use') {
      reply = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n')
      break
    }

    const uses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')

    // Escalation restarts the turn on the stronger model rather than continuing,
    // so the whole problem gets the better reasoning, not just what comes after.
    const deep = uses.find((u) => u.name === 'request_deep_analysis')
    if (deep && model !== DEEP_MODEL) {
      model = DEEP_MODEL
      escalated = (deep.input as { reason?: string }).reason ?? 'harder than it looked'
      continue
    }

    messages.push({ role: 'assistant', content: res.content })

    // All results go back in ONE user message. Splitting them trains the model
    // to stop making parallel calls.
    const results: Anthropic.ToolResultBlockParam[] = []
    for (const u of uses) {
      const tool = TOOLS[u.name]
      toolCalls.push({ name: u.name, input: u.input })
      if (!tool) {
        results.push({ type: 'tool_result', tool_use_id: u.id, content: 'no such tool', is_error: true })
        continue
      }
      try {
        const out = await tool.run(u.input)
        if (u.name !== 'query_status' && u.name !== 'request_deep_analysis') {
          writes.push({ tool: u.name, summary: JSON.stringify(out) })
        }
        results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out) })
      } catch (e) {
        // Hand the failure back rather than dropping it — Claude should tell
        // Cleo it did not work, not silently continue as though it had.
        results.push({
          type: 'tool_result', tool_use_id: u.id, is_error: true,
          content: `failed: ${(e as Error).message}`,
        })
      }
    }
    messages.push({ role: 'user', content: results })
  }

  await db.chatMessage.create({
    data: {
      threadId: thread.id, role: 'ASSISTANT',
      content: reply || '(no reply)',
      toolCallsJson: toolCalls.length ? (toolCalls as never) : undefined,
      model,
    },
  })

  return NextResponse.json({
    threadId: thread.id,
    userMessageId: userRow.id,
    reply,
    writes,
    model,
    escalated,
  })
}
