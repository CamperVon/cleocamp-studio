'use server'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { poLineLabel } from '@/lib/po'
import { runAgent } from '@/lib/mouse/agent'
import { requireComplete } from '@/lib/mouse/runner'
import { currentPersonId } from '@/lib/session'

/**
 * An update typed against a specific run or order.
 *
 * Routed through the agent rather than appended as text, so "the dye house says
 * a week late" moves the date, shifts the payment that hangs off it, and lands
 * on the calendar — instead of becoming a note nobody reads.
 */
export async function addInFlightUpdate(
  kind: 'run' | 'po',
  id: string,
  text: string,
) {
  if (!text.trim()) return null

  let subject = ''
  let noteEntity: { entityType: 'PRODUCTION_RUN' | 'PURCHASE_ORDER'; entityId: string } | null = null
  if (kind === 'run') {
    const r = await db.productionRun.findUnique({
      where: { id },
      include: { product: true, vendor: true },
    })
    if (!r) return null
    noteEntity = { entityType: 'PRODUCTION_RUN', entityId: r.id }
    subject =
      `Production run [${r.id}] — ${r.product.name} at ${r.vendor?.name ?? 'no maker set'}, ` +
      `currently ${r.status}, expected ${r.expectedReadyAt?.toISOString().slice(0, 10) ?? 'unknown'}.`
  } else {
    const p = await db.purchaseOrder.findUnique({
      where: { id },
      include: { vendor: true, lines: { orderBy: { id: 'asc' }, include: { component: true, productVariant: { include: { product: true, colorway: true } } } } },
    })
    if (!p) return null
    noteEntity = { entityType: 'PURCHASE_ORDER', entityId: p.id }
    subject =
      `Purchase order ${p.poNumber} to ${p.vendor.name} — ` +
      `${p.lines.map((l) => `${l.qtyOrdered} ${l.unit} ${poLineLabel(l)}`).join(', ')}, ` +
      `${p.status}, expected ${p.expectedAt?.toISOString().slice(0, 10) ?? 'unconfirmed'}.`
  }

  // The person's own words, kept verbatim and shown under the row. Until
  // 23 Sept 2026 only the agent's paraphrase was kept: Brandon typed that PO
  // 2356 was delivered and paid, the agent recorded "paid, no ship date yet",
  // left the order open, and nothing anywhere said what he had actually
  // written.
  const who = await currentPersonId()
  const person = who ? await db.person.findUnique({ where: { id: who }, select: { name: true } }) : null
  await db.note.create({
    data: { ...noteEntity!, source: 'MANUAL', content: `${person?.name ?? 'Update'}: \u201c${text.trim()}\u201d` },
  })

  const result = await runAgent({
    source: 'in-flight',
    instruction:
      `An update about one specific thing in flight.\n\n${subject}\n\n` +
      `The update is: ${text.trim()}\n\n` +
      `Apply it. Move dates, change the stage, adjust anything downstream that ` +
      `follows from it, and record a note against this item so the history is kept. ` +
      `If it changes when something arrives, put that on the calendar. Do not just ` +
      `write down what you were told.\n\n` +
      `APPLY EVERY FACT IN IT, each on its own. Paid and delivered are different ` +
      `things: "delivered and paid" means set RECEIVED with receivedAt AND record the ` +
      `payment. If it says the goods arrived, were delivered, landed or came in, the ` +
      `order is received — do not leave it open because an older note said no date ` +
      `had been given. This update is newer than every note you have. ` +
      `End with one short sentence saying exactly what you changed.`,
    effort: 'medium',
  })
  requireComplete(result)

  // Only meaningful inside a request; called directly from a script it throws.
  try {
    revalidatePath('/')
    revalidatePath('/finances')
  } catch {
    // The work is already done either way.
  }
  // Shown under the row, so a misreading is seen at once rather than found
  // on the calendar the next morning.
  return result.text.trim().split('\n').filter(Boolean).slice(-1)[0] ?? null
}
