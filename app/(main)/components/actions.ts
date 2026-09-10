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
/**
 * Add a vendor from inside the Components form, without leaving the page.
 *
 * Deliberately just a name — everything else (contact, terms, lead time)
 * is filled in the normal way later, from the Vendors page or in chat. This
 * exists to unblock "the vendor I need isn't in the list yet", not to
 * duplicate the full vendor form.
 *
 * Checks for an existing vendor by name first (case-insensitive) rather than
 * creating a second row for the same vendor because someone typed it in
 * lowercase — the exact kind of duplicate this app has run into with
 * colourways and products, fixed the same way there: check what the thing
 * IS before creating something beside it.
 */
export async function createVendorQuick(name: string): Promise<{ id: string; name: string }> {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Vendor name required')

  const existing = await db.vendor.findFirst({
    where: { name: { equals: trimmed, mode: 'insensitive' } },
    select: { id: true, name: true },
  })
  if (existing) return existing

  const vendor = await db.vendor.create({
    data: { name: trimmed },
    select: { id: true, name: true },
  })

  try {
    revalidatePath('/components')
    revalidatePath('/vendors')
  } catch {
    // Not in a request context.
  }
  return vendor
}

/**
 * Add a component that is missing entirely, from the Components page.
 *
 * A plain write, same reasoning as updateComponentDetails below: someone is
 * typing in a fact they already know, not asking Mouse to make a judgement
 * call. Brandon, 10 Sept: "we should be able to add other components if
 * they are missing. if SM has questions, he can bring up in corner or
 * todo" — so this does not block on completeness or route through the
 * agent to ask anything up front. Only name, category and unit are
 * required; everything else can be filled in later, from this same page,
 * exactly like an existing component's blanks.
 */
export async function createComponent(data: {
  name: string
  category: string
  unitOfMeasure: string
  stockedInStudio: boolean
  vendorId: string | null
  vendorSku: string | null
  unitCostCents: number | null
  leadTimeDays: number | null
}) {
  const name = data.name.trim()
  const unitOfMeasure = data.unitOfMeasure.trim()
  if (!name || !unitOfMeasure) throw new Error('Name and unit of measure are required')

  await db.component.create({
    data: {
      name,
      category: data.category as never,
      unitOfMeasure,
      stockedInStudio: data.stockedInStudio,
      vendorId: data.vendorId,
      vendorSku: data.vendorSku?.trim() || null,
      unitCostCents: data.unitCostCents,
      leadTimeDays: data.leadTimeDays,
    },
  })

  try {
    revalidatePath('/components')
  } catch {
    // Not in a request context.
  }
}

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
