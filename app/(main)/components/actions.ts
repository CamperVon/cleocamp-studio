'use server'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'

/**
 * Filling in a component's vendor, style number, cost or lead time from the
 * Components page.
 *
 * Deliberately a plain write, not a round trip through Studio Mouse. These
 * are facts someone is reading off an invoice or a vendor's site and typing
 * in directly — there is no judgment call for Mouse to make, and routing it
 * through the agent would add latency and an LLM's improvisation to what is
 * just a form. Compare app/(main)/items/actions.ts, where answering a
 * question can imply other changes and going through the agent earns its
 * keep.
 *
 * Never touches onHandQty or incomingQty — those are the append-only ledger
 * CLAUDE.md §3 describes, and a raw field edit here would be exactly the
 * "seed a stale number" it forbids. A count comes from log_inventory_event,
 * never from this form.
 */
export async function updateComponentDetails(
  id: string,
  data: { vendorId: string | null; vendorSku: string | null; unitCostCents: number | null; leadTimeDays: number | null },
) {
  const component = await db.component.update({
    where: { id },
    data: {
      vendorId: data.vendorId,
      vendorSku: data.vendorSku?.trim() || null,
      unitCostCents: data.unitCostCents,
      leadTimeDays: data.leadTimeDays,
    },
  })

  // Filling in the blank is answering the question, even when nobody thinks
  // of it that way — close the loop rather than leaving an open item sitting
  // there for something that just got filled in on this exact screen.
  const filled = [
    data.vendorId ? 'a vendor' : null,
    data.vendorSku ? 'a style number' : null,
    data.unitCostCents !== null ? 'a price' : null,
    data.leadTimeDays !== null ? 'a lead time' : null,
  ].filter(Boolean)
  if (filled.length) {
    await db.actionItem.updateMany({
      where: { kind: 'QUESTION', resolved: false, entityType: 'COMPONENT', entityId: id },
      data: {
        resolved: true,
        resolvedAt: new Date(),
        resolutionNote: `Filled in on the Components page: ${filled.join(', ')} for ${component.name}.`,
      },
    })
  }

  // Guarded the same way app/(main)/items/actions.ts does — revalidatePath
  // throws when called outside a real Next.js request (a test script calling
  // this directly, say), and the write above has already happened either way.
  try {
    revalidatePath('/components')
    revalidatePath('/items')
  } catch {
    // Not in a request context.
  }
}
