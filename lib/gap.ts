import { diagnosticValue } from '@/lib/mouse/outcomes'
import { db } from '@/lib/db'

/**
 * Packaging a gap report into something someone can act on cold.
 *
 * The whole point of a gap report is that whoever changes the code should not
 * have to ask what happened. So this reads the LIVE thread around the reported
 * reply — not a copy taken at report time — which means a correction, a second
 * attempt that worked, or the real answer arriving later are all in the
 * package too. Those are often the most useful part: "Mouse said no, then did
 * it a different way" is a different bug from "Mouse said no and that was
 * that".
 *
 * TURNS_BEFORE is small on purpose. The exchange that produced the refusal is
 * what matters; a whole day's chat is the same problem as a screenshot, just
 * longer.
 */
const TURNS_BEFORE = 4
const TURNS_AFTER = 2

export type PackagedGap = {
  id: string
  title: string
  note: string | null
  reportedAt: Date
  /** Null when the chat message has since been deleted with its thread. */
  exchange: Array<{
    role: 'user' | 'assistant'
    text: string
    isTheReportedReply: boolean
    tools: Array<{ name: string; input: unknown; status?: string; result?: unknown; error?: string }>
  }> | null
  /** The same thing as plain text, for pasting into a Claude Code session. */
  asText: string
}

export async function packageGap(item: {
  id: string
  title: string
  detail: string | null
  entityId: string | null
  createdAt: Date
}): Promise<PackagedGap> {
  const base = { id: item.id, title: item.title, note: item.detail, reportedAt: item.createdAt }

  const message = item.entityId
    ? await db.chatMessage.findUnique({
        where: { id: item.entityId },
        select: { id: true, threadId: true, createdAt: true },
      })
    : null
  if (!message) {
    return { ...base, exchange: null, asText: `${item.title}${item.detail ? `\n\n${item.detail}` : ''}` }
  }

  const [before, after] = await Promise.all([
    db.chatMessage.findMany({
      where: { threadId: message.threadId, createdAt: { lte: message.createdAt } },
      orderBy: { createdAt: 'desc' },
      take: TURNS_BEFORE + 1,
      select: { id: true, role: true, content: true, toolCallsJson: true, agentUsageJson: true },
    }),
    db.chatMessage.findMany({
      where: { threadId: message.threadId, createdAt: { gt: message.createdAt } },
      orderBy: { createdAt: 'asc' },
      take: TURNS_AFTER,
      select: { id: true, role: true, content: true, toolCallsJson: true, agentUsageJson: true },
    }),
  ])

  const rows = [...before.reverse(), ...after]
  const exchange = rows.map((m) => ({
    role: (m.role === 'USER' ? 'user' : 'assistant') as 'user' | 'assistant',
    text: String(diagnosticValue(m.content)),
    isTheReportedReply: m.id === message.id,
    tools: Array.isArray(m.toolCallsJson)
      ? (diagnosticValue(m.toolCallsJson) as Array<{ name: string; input: unknown; status?: string; result?: unknown; error?: string }>)
      : [],
  }))

  const asText = [
    `Studio Mouse gap report — ${item.createdAt.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })}`,
    item.detail ? `\nWhat was wanted: ${item.detail}` : '',
    '\nThe exchange:',
    ...exchange.map((m) => {
      const who = m.role === 'user' ? 'Person' : 'Mouse'
      const mark = m.isTheReportedReply ? '  <<< reported' : ''
    const tools = m.tools.length
        ? `\n    tools: ${m.tools.map((t) => `${t.name}(${JSON.stringify(t.input)}): ${t.status ?? 'outcome not recorded'} ${JSON.stringify(t.error ?? t.result ?? null)}`).join(', ')}`
        : '\n    tools: none'
      return `\n${who}:${mark}\n    ${m.text.replace(/\n/g, '\n    ')}${tools}`
    }),
  ].join('')

  return { ...base, exchange, asText }
}
