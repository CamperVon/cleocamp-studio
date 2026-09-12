'use server'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'

/**
 * Filling in a component's details from the Components page.
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

/** revalidatePath throws outside a real request (a script calling in). */
function refresh() {
  try {
    revalidatePath('/components')
    revalidatePath('/items')
  } catch {
    // Not in a request context.
  }
}

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

  const vendor = await db.vendor.create({ data: { name: trimmed }, select: { id: true, name: true } })
  refresh()
  try {
    revalidatePath('/vendors')
  } catch {
    // Not in a request context.
  }
  return vendor
}

/**
 * Put a component on a product's bill of materials, or change how much of it
 * that product takes.
 *
 * Brandon, 11 Sept: "every component belongs to a product or shipping... when
 * adding a component or editing a component we should be able to attach it to
 * a product." A component with no product is not a kind of component — it is
 * data nobody has entered yet.
 *
 * The quantity is required and has no default. A bill-of-materials line IS a
 * quantity; one label per dress and 0.7 yards per tee are both real figures
 * somebody knows, and quietly writing 1 because it is usually 1 would be
 * exactly the invented number CLAUDE.md §3 forbids. Asking for it is one
 * keystroke; a wrong figure silently wrong in a forecast is not.
 */
export async function attachComponentToProduct(
  componentId: string,
  productId: string,
  qtyPerUnit: number | null,
) {
  // Brandon, 12 Sept: "need to be able to save even if we don't have the
  // yardage etc." Requiring it here was my mistake, and the wrong reading of
  // CLAUDE.md: the rule forbids INVENTING a number, not recording a fact you
  // do know. "This goes into that" and "one takes 0.7 yards" are two separate
  // facts, and blocking the first because the second is missing loses the one
  // somebody actually had.
  //
  // 0 is already this codebase's "not known yet" for a BOM quantity — the
  // Products page renders it as "unknown" and counts it as a gap, and
  // lib/forecast.ts skips such a line rather than forecasting from a zero.
  // Reusing that beats a nullable column and a second way of saying the same
  // thing, which every read site would then have to handle.
  const qty = qtyPerUnit != null && Number.isFinite(qtyPerUnit) && qtyPerUnit > 0 ? qtyPerUnit : 0
  const existing = await db.bomLine.findFirst({
    where: { parentProductId: productId, componentId },
    select: { id: true },
  })
  const data = { parentProductId: productId, componentId, qtyPerUnit: String(qty) }
  if (existing) await db.bomLine.update({ where: { id: existing.id }, data })
  else await db.bomLine.create({ data })
  refresh()
}

/** Take a component off one product. It stays a component, and stays on any other product. */
export async function detachComponentFromProduct(componentId: string, productId: string) {
  await db.bomLine.deleteMany({ where: { parentProductId: productId, componentId } })
  refresh()
}

/**
 * Add a component that is missing entirely, from the Components page.
 *
 * A plain write, same reasoning as updateComponentDetails below: someone is
 * typing in a fact they already know, not asking Mouse to make a judgement
 * call. Brandon, 10 Sept: "we should be able to add other components if
 * they are missing. if SM has questions, he can bring up in corner or
 * todo" — so this does not block on completeness. Only name, category and
 * unit are required.
 *
 * A product can be named right here, with how much of it that product takes,
 * so a new component starts out attached rather than landing in the unassigned
 * pile for someone to find later.
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
  /** Brandon, 12 Sept: "we might need to add to multiple products." One tag
   *  goes on eleven things; making someone save the component and then attach
   *  it ten more times is the slow path this form exists to avoid. Each entry
   *  carries its own quantity, because a bag and a tee do not necessarily take
   *  the same amount of the same thing. */
  attachments?: { productId: string; qtyPerUnit: number | null }[]
}) {
  const name = data.name.trim()
  const unitOfMeasure = data.unitOfMeasure.trim()
  if (!name || !unitOfMeasure) throw new Error('Name and unit of measure are required')

  const component = await db.component.create({
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
    select: { id: true },
  })

  for (const a of data.attachments ?? []) {
    await attachComponentToProduct(component.id, a.productId, a.qtyPerUnit)
  }

  refresh()
}

export async function updateComponentDetails(
  id: string,
  data: {
    name: string
    vendorId: string | null
    vendorSku: string | null
    unitCostCents: number | null
    leadTimeDays: number | null
    stockedInStudio: boolean
  },
) {
  // Brandon, 11 Sept: "we need to be able to edit the names if they are not
  // quite right... on the component page itself." Studio Mouse can rename too,
  // but tidying four names in a row is a form's job, not a conversation's.
  const name = data.name.trim()
  if (!name) throw new Error('A component needs a name')

  const component = await db.component.update({
    where: { id },
    data: {
      name,
      vendorId: data.vendorId,
      vendorSku: data.vendorSku?.trim() || null,
      unitCostCents: data.unitCostCents,
      leadTimeDays: data.leadTimeDays,
      stockedInStudio: data.stockedInStudio,
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

  refresh()
}

/**
 * Take a component off the Components page.
 *
 * Brandon, 11 Sept: "we need to be able to delete components in the components
 * page." Two different things wear that word, and the difference matters:
 *
 *  - Something added by mistake — a typo, a duplicate typed twice — that no
 *    product, order or count has ever referred to. Nothing points at it and
 *    nothing remembers it, so it is deleted outright.
 *  - Something real that is simply finished with. Deleting that would take a
 *    bill-of-materials line, a purchase order line a vendor was actually sent,
 *    or a row of the append-only ledger down with it (CLAUDE.md §3). It is
 *    retired instead — off the page, still readable wherever it is referenced.
 *
 * The database already enforces this: BomLine.component, InventoryEvent.component
 * and PurchaseOrderLine.component carry no onDelete, so Postgres restricts the
 * delete. Checking here first is only so the answer is a sentence rather than a
 * foreign-key error.
 */
export async function removeComponent(
  id: string,
): Promise<{ deleted: boolean; name: string; reason: string | null }> {
  const component = await db.component.findUnique({
    where: { id },
    select: {
      name: true,
      _count: { select: { usedIn: true, subAssembly: true, poLines: true, events: true } },
    },
  })
  if (!component) throw new Error('No such component')

  const holds = [
    component._count.usedIn ? `${component._count.usedIn} bill-of-materials line(s)` : null,
    component._count.subAssembly ? `${component._count.subAssembly} sub-assembly line(s)` : null,
    component._count.poLines ? `${component._count.poLines} purchase order line(s)` : null,
    component._count.events ? `${component._count.events} inventory event(s)` : null,
  ].filter(Boolean)

  if (holds.length) {
    await db.component.update({ where: { id }, data: { active: false } })
  } else {
    // Only ComponentLocationStock and ForecastResult cascade, and both are
    // derived rows — nothing anyone wrote by hand is lost here.
    await db.component.delete({ where: { id } })
  }

  refresh()

  return {
    deleted: holds.length === 0,
    name: component.name,
    reason: holds.length ? `still on ${holds.join(', ')}` : null,
  }
}

/** Undo a retire — for one taken off the page by mistake. */
export async function restoreComponent(id: string) {
  await db.component.update({ where: { id }, data: { active: true } })
  refresh()
}
