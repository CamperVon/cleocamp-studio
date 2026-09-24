import Anthropic from '@anthropic-ai/sdk'
import { db } from '@/lib/db'
import { Prisma } from '@/generated/prisma/client'
import { CHAT_MODEL } from '@/lib/mouse/agent'
import { recordUsage, usageOf } from '@/lib/mouse/usage'
import type { OrderSnapshot } from '@/lib/support/orders'
import { addressChangeProblems, DRAFT_INSTRUCTIONS, orderFacts, parseDraft } from '@/lib/support/reply'

/**
 * Write (or rewrite) the drafted reply on one case.
 *
 * Same rule as the reader in pass.ts: this model has NO tools. It sees the
 * conversation, the order facts code looked up, and the policy, and returns
 * text. What it drafts is stored for a person to read — it cannot reach the
 * customer, Shopify or the database by itself.
 *
 * Spam and closed cases are not drafted. A failure leaves the case with no
 * draft, which the card shows as "no draft" — never a half-written one.
 */
export async function draftForCase(caseId: string): Promise<void> {
  const c = await db.supportCase.findUnique({
    where: { id: caseId },
    include: { messages: { orderBy: { createdAt: 'asc' }, take: 12 } },
  })
  if (!c || c.category === 'SPAM' || c.status === 'RESOLVED') return

  const order = (c.orderSnapshot as OrderSnapshot | null) ?? null
  const thread = c.messages
    .filter((m) => m.direction !== 'NOTE')
    .map((m) => `${m.direction === 'INBOUND' ? 'CUSTOMER' : 'US'} (${m.createdAt.toISOString().slice(0, 10)}):\n${m.body.slice(0, 2500)}`)
    .join('\n---\n')

  let raw = ''
  try {
    const startedAt = Date.now()
    const res = await new Anthropic().messages.create({
      model: CHAT_MODEL,
      max_tokens: 1500,
      system: DRAFT_INSTRUCTIONS,
      output_config: { effort: 'low' },
      messages: [{
        role: 'user',
        content:
          `Today is ${new Date().toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: 'long', day: 'numeric' })}.\n` +
          `Customer: ${c.customerName ?? 'name unknown'} <${c.customerEmail}>. Sorted as: ${c.category}.\n\n` +
          `ORDER FACTS (from Shopify, checked by code):\n${orderFacts(order)}\n\n` +
          `<conversation>\n${thread.slice(-9000)}\n</conversation>\n\n` +
          `Draft the reply to the customer's latest email.`,
      }],
    })
    await recordUsage('support-draft', [usageOf(CHAT_MODEL, res.usage, startedAt)])
    raw = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('')
  } catch (e) {
    console.error('[support] draft failed', caseId, e)
    return
  }

  const d = parseDraft(raw)
  if (!d) return
  // The checks are run and stored now so the card can show them, and run
  // again against a fresh read of the order at the moment someone taps.
  const address = d.newAddress
    ? { to: d.newAddress, from: order?.shipTo ?? null, problems: addressChangeProblems(order, c.customerEmail, d.newAddress) }
    : null
  await db.supportCase.update({
    where: { id: caseId },
    data: {
      draftReply: d.reply,
      draftNeeds: d.needs,
      draftAddress: address ? (address as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
      draftedAt: new Date(),
    },
  })
}
