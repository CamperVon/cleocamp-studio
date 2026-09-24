'use server'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { runAgent } from '@/lib/mouse/agent'
import { requireComplete } from '@/lib/mouse/runner'

/**
 * Answering a question should do two things: close it, and apply whatever the
 * answer implies. Routing it through the agent means telling it the dye house
 * takes two weeks both resolves the question and writes the lead time.
 */
export async function answerItem(id: string, answer: string): Promise<string | null> {
  const item = await db.actionItem.findUnique({ where: { id } })
  if (!item || !answer.trim()) return null

  const result = await runAgent({
    source: 'answer-item',
    instruction:
      `This answers an open item.\n\n` +
      `Item [${item.id}]: ${item.title}\n` +
      `${item.detail ? `Detail: ${item.detail}\n` : ''}` +
      `\nThe answer is: ${answer.trim()}\n\n` +
      `Resolve it with resolve_item, and apply whatever the answer implies — ` +
      `write it to the right field, update the order, put a date on the calendar. ` +
      `Do not just record the words. End with one short sentence saying exactly what you changed.`,
    effort: 'medium',
  })
  requireComplete(result)

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
  // Shown where the answer was typed, so a misreading is seen at once.
  return result.text.trim().split('\n').filter(Boolean).slice(-1)[0] ?? null
}

/**
 * Where a product physically is, told from its row on Home. Routed through
 * Mouse, like an order's update box, so it lands on a production run and the
 * calendar rather than as loose text.
 */
export async function tellProductStage(productId: string, text: string): Promise<string | null> {
  if (!text.trim()) return null
  const p = await db.product.findUnique({ where: { id: productId }, select: { id: true, name: true } })
  if (!p) return null
  const result = await runAgent({
    source: 'product-stage',
    instruction:
      `An update about where the ${p.name} [${p.id}] physically is in production.\n\n` +
      `The update is: ${text.trim()}\n\n` +
      `Record it on the right production run — update the run if one exists for this product, ` +
      `create one if not — with its stage and any date given. If it changes when something ` +
      `arrives, put that on the calendar. End with one short sentence saying exactly what you changed.`,
    effort: 'medium',
  })
  requireComplete(result)
  refresh()
  return result.text.trim().split('\n').filter(Boolean).slice(-1)[0] ?? null
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

// ── The weekly review's suggestions (lib/mouse/tidy.ts) ──────────────────
// Closing is a person's tap, never the review's own act.

async function signedIn() {
  const { currentPersonId } = await import('@/lib/session')
  const id = await currentPersonId()
  return id ? db.person.findFirst({ where: { id, active: true, external: false }, select: { name: true } }) : null
}

/** Close one item the review suggested, keeping its reason as the resolution. */
export async function closeSuggested(id: string): Promise<void> {
  const who = await signedIn()
  if (!who) return
  const i = await db.actionItem.findUnique({ where: { id } })
  if (!i || i.resolved || !i.closeSuggestion) return
  await db.actionItem.update({
    where: { id },
    data: { resolved: true, resolvedAt: new Date(), resolutionNote: `Closed on Mouse's weekly review, confirmed by ${who.name}: ${i.closeSuggestion}` },
  })
  refresh()
}

/** "Not done" — drop the suggestion and leave it alone for a month. */
export async function keepOpen(id: string): Promise<void> {
  if (!(await signedIn())) return
  await db.actionItem.update({ where: { id }, data: { closeSuggestion: null, closeSuggestedAt: null, keptOpenAt: new Date() } })
  refresh()
}

export async function closeAllSuggested(): Promise<void> {
  const who = await signedIn()
  if (!who) return
  const items = await db.actionItem.findMany({ where: { resolved: false, closeSuggestion: { not: null } } })
  const now = new Date()
  for (const i of items) {
    await db.actionItem.update({
      where: { id: i.id },
      data: { resolved: true, resolvedAt: now, resolutionNote: `Closed on Mouse's weekly review, confirmed by ${who.name}: ${i.closeSuggestion}` },
    })
  }
  refresh()
}

/** Run the review now instead of waiting for Monday. */
export async function reviewNow(): Promise<{ reviewed: number; suggested: number } | null> {
  if (!(await signedIn())) return null
  const { reviewOpenItems } = await import('@/lib/mouse/tidy')
  const r = await reviewOpenItems()
  refresh()
  return r
}
