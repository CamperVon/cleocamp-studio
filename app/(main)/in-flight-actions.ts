'use server'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { poLineLabel } from '@/lib/po'
import { runAgent } from '@/lib/mouse/agent'

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
  if (!text.trim()) return

  let subject = ''
  if (kind === 'run') {
    const r = await db.productionRun.findUnique({
      where: { id },
      include: { product: true, vendor: true },
    })
    if (!r) return
    subject =
      `Production run [${r.id}] — ${r.product.name} at ${r.vendor?.name ?? 'no maker set'}, ` +
      `currently ${r.status}, expected ${r.expectedReadyAt?.toISOString().slice(0, 10) ?? 'unknown'}.`
  } else {
    const p = await db.purchaseOrder.findUnique({
      where: { id },
      include: { vendor: true, lines: { include: { component: true, productVariant: { include: { product: true, colorway: true } } } } },
    })
    if (!p) return
    subject =
      `Purchase order ${p.poNumber} to ${p.vendor.name} — ` +
      `${p.lines.map((l) => `${l.qtyOrdered} ${l.unit} ${poLineLabel(l)}`).join(', ')}, ` +
      `${p.status}, expected ${p.expectedAt?.toISOString().slice(0, 10) ?? 'unconfirmed'}.`
  }

  await runAgent({
    instruction:
      `An update about one specific thing in flight.\n\n${subject}\n\n` +
      `The update is: ${text.trim()}\n\n` +
      `Apply it. Move dates, change the stage, adjust anything downstream that ` +
      `follows from it, and record a note against this item so the history is kept. ` +
      `If it changes when something arrives, put that on the calendar. Do not just ` +
      `write down what you were told.`,
    effort: 'medium',
  })

  // Only meaningful inside a request; called directly from a script it throws.
  try {
    revalidatePath('/')
    revalidatePath('/finances')
  } catch {
    // The work is already done either way.
  }
}
