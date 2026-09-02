'use server'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { runAgent } from '@/lib/mouse/agent'

/**
 * Answering a question should do two things: close it, and apply whatever the
 * answer implies. Routing it through the agent means telling it the dye house
 * takes two weeks both resolves the question and writes the lead time.
 */
export async function answerItem(id: string, answer: string) {
  const item = await db.actionItem.findUnique({ where: { id } })
  if (!item || !answer.trim()) return

  await runAgent({
    instruction:
      `This answers an open item.\n\n` +
      `Item [${item.id}]: ${item.title}\n` +
      `${item.detail ? `Detail: ${item.detail}\n` : ''}` +
      `\nThe answer is: ${answer.trim()}\n\n` +
      `Resolve it with resolve_question, and apply whatever the answer implies — ` +
      `write it to the right field, update the order, put a date on the calendar. ` +
      `Do not just record the words.`,
    effort: 'medium',
  })

  // Belt and braces: if the agent did not resolve it, close it anyway so the
  // list does not keep showing something already answered.
  const after = await db.actionItem.findUnique({ where: { id } })
  if (after && !after.resolved) {
    await db.actionItem.update({
      where: { id },
      data: { resolved: true, resolvedAt: new Date(), resolutionNote: answer.trim() },
    })
  }
  refresh()
}

/** Only meaningful inside a request; called directly from a script it throws. */
function refresh() {
  try {
    revalidatePath('/')
    revalidatePath('/items')
  } catch {
    // Not in a request context — the work is already done either way.
  }
}

export async function dismissItem(id: string) {
  await db.actionItem.update({
    where: { id },
    data: {
      resolved: true,
      resolvedAt: new Date(),
      resolutionNote: 'Dismissed — already handled or not needed.',
    },
  })
  refresh()
}
