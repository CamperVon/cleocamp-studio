import type Anthropic from '@anthropic-ai/sdk'
import { db } from '@/lib/db'

/** A tool definition paired with the code that runs it. */
type Tool = {
  def: Anthropic.Tool
  run: (input: any) => Promise<unknown>
}

const str = (description: string) => ({ type: 'string' as const, description })
const num = (description: string) => ({ type: 'number' as const, description })

/**
 * Writing an inventory event and updating the cached quantity must happen
 * together or the two disagree. onHandQty is a materialized sum of the ledger
 * and has to stay recomputable from it. See CLAUDE.md §3.
 */
async function writeEvent(args: {
  componentId?: string
  productVariantId?: string
  deltaQty: number
  countedQty?: number
  type: string
  note?: string
}) {
  return db.$transaction(async (tx) => {
    const event = await tx.inventoryEvent.create({
      data: {
        componentId: args.componentId ?? null,
        productVariantId: args.productVariantId ?? null,
        deltaQty: String(args.deltaQty),
        countedQty: args.countedQty === undefined ? null : String(args.countedQty),
        type: args.type as never,
        source: 'CHAT',
        note: args.note ?? null,
      },
    })

    if (args.componentId) {
      const c = await tx.component.findUniqueOrThrow({ where: { id: args.componentId } })
      const next = args.countedQty ?? Number(c.onHandQty) + args.deltaQty
      await tx.component.update({
        where: { id: args.componentId },
        data: { onHandQty: String(next) },
      })
      return { eventId: event.id, name: c.name, newQty: next }
    }

    const v = await tx.productVariant.findUniqueOrThrow({
      where: { id: args.productVariantId! },
      include: { product: true, colorway: true },
    })
    // Null means unknown, not zero. A delta against an unknown count leaves it
    // unknown rather than inventing a number from nowhere.
    const next =
      args.countedQty ??
      (v.onHandQty === null ? null : Number(v.onHandQty) + args.deltaQty)
    await tx.productVariant.update({
      where: { id: v.id },
      data: { onHandQty: next === null ? null : String(next) },
    })
    const name = [v.product.name, v.colorway?.customerName, v.size].filter(Boolean).join(' / ')
    return { eventId: event.id, name, newQty: next ?? 'still unknown' }
  })
}

export const TOOLS: Record<string, Tool> = {
  log_inventory_event: {
    def: {
      name: 'log_inventory_event',
      description:
        'Record a change in stock. Use for receiving goods, shipping wholesale, gifting, ' +
        'returns, stylist pulls, or a physical count. Exactly one of componentId or ' +
        'productVariantId. For COUNTED give countedQty (the absolute number stated) — ' +
        'deltaQty is then ignored.',
      input_schema: {
        type: 'object',
        properties: {
          componentId: str('Component id, if this is a component'),
          productVariantId: str('Variant id, if this is a finished product'),
          type: {
            type: 'string',
            enum: ['RECEIVED', 'USED', 'COUNTED', 'MANUAL_ADJUST', 'GIFTED',
                   'WHOLESALE_SHIPPED', 'STYLIST_PULL_OUT', 'STYLIST_PULL_RETURN', 'RETURNED'],
            description: 'WHOLESALE_SHIPPED and GIFTED count as demand. Stylist pulls do not.',
          },
          deltaQty: num('Signed change. Negative for things leaving.'),
          countedQty: num('For COUNTED only: the absolute number stated.'),
          note: str('Who it went to, why, anything worth keeping.'),
        },
        required: ['type', 'deltaQty'],
      },
    },
    run: (i) => writeEvent(i),
  },

  correct_inventory_event: {
    def: {
      name: 'correct_inventory_event',
      description:
        'Undo an earlier event. Writes a CORRECTION that nets it out; the original stays ' +
        'in the ledger. Never edit or delete an event.',
      input_schema: {
        type: 'object',
        properties: {
          eventId: str('The event to reverse'),
          note: str('Why it was wrong'),
        },
        required: ['eventId'],
      },
    },
    run: async (i) => {
      const orig = await db.inventoryEvent.findUniqueOrThrow({ where: { id: i.eventId } })
      const r = await writeEvent({
        componentId: orig.componentId ?? undefined,
        productVariantId: orig.productVariantId ?? undefined,
        deltaQty: -Number(orig.deltaQty),
        type: 'CORRECTION',
        note: i.note ?? `Reverses ${orig.id}`,
      })
      await db.inventoryEvent.update({
        where: { id: r.eventId as string },
        data: { correctsEventId: orig.id },
      })
      return { ...r, reversed: orig.id }
    },
  },

  raise_question: {
    def: {
      name: 'raise_question',
      description:
        'Record something you need to know but were not told. Use whenever you would ' +
        'otherwise guess. Cheap — raise it rather than assume.',
      input_schema: {
        type: 'object',
        properties: {
          title: str('The question, plainly'),
          detail: str('Why it matters and what it blocks'),
          entityType: { type: 'string', enum: ['VENDOR','PRODUCT','PRODUCT_VARIANT','COMPONENT','PRODUCTION_RUN','PURCHASE_ORDER','GENERAL'] },
          entityId: str('What it is about, if anything'),
        },
        required: ['title'],
      },
    },
    run: async (i) =>
      db.actionItem.create({
        data: {
          kind: 'QUESTION', title: i.title, detail: i.detail ?? null,
          entityType: (i.entityType ?? 'GENERAL') as never,
          entityId: i.entityId ?? null, source: 'CHAT',
        },
        select: { id: true, title: true },
      }),
  },

  resolve_question: {
    def: {
      name: 'resolve_question',
      description: 'Mark an open question answered, recording the answer.',
      input_schema: {
        type: 'object',
        properties: { id: str('Question id'), resolution: str('The answer') },
        required: ['id', 'resolution'],
      },
    },
    run: async (i) =>
      db.actionItem.update({
        where: { id: i.id },
        data: { resolved: true, resolvedAt: new Date(), resolutionNote: i.resolution },
        select: { id: true, title: true },
      }),
  },

  create_todo: {
    def: {
      name: 'create_todo',
      description: 'Record something a person needs to do, optionally by a date.',
      input_schema: {
        type: 'object',
        properties: {
          title: str('What needs doing'),
          detail: str('Any detail'),
          dueDate: str('ISO date, e.g. 2026-09-15'),
        },
        required: ['title'],
      },
    },
    run: async (i) =>
      db.actionItem.create({
        data: {
          kind: 'TODO', title: i.title, detail: i.detail ?? null,
          dueDate: i.dueDate ? new Date(i.dueDate + 'T12:00:00-07:00') : null,
          source: 'CHAT',
        },
        select: { id: true, title: true, dueDate: true },
      }),
  },

  add_note: {
    def: {
      name: 'add_note',
      description:
        'Record something worth keeping that is not a number — a workflow, a preference, ' +
        'what a vendor said. Use once you understand it, not to park a half-answer.',
      input_schema: {
        type: 'object',
        properties: {
          content: str('The note'),
          entityType: { type: 'string', enum: ['VENDOR','PRODUCT','PRODUCT_VARIANT','COMPONENT','PRODUCTION_RUN','PURCHASE_ORDER','GENERAL'] },
          entityId: str('What it is about'),
        },
        required: ['content'],
      },
    },
    run: async (i) =>
      db.note.create({
        data: {
          content: i.content, entityType: (i.entityType ?? 'GENERAL') as never,
          entityId: i.entityId ?? null, source: 'CHAT',
        },
        select: { id: true },
      }),
  },

  update_component: {
    def: {
      name: 'update_component',
      description:
        'Change a component: price, lead time, vendor, style number, reorder threshold. ' +
        'Only set fields you were actually told.',
      input_schema: {
        type: 'object',
        properties: {
          id: str('Component id'),
          unitCostCents: num('Price in cents per unit of measure'),
          leadTimeDays: num('Days from order to in hand. 0 means in stock.'),
          vendorId: str('New vendor id'),
          vendorSku: str("The vendor's own style number"),
          reorderThreshold: num('Level at which to reorder'),
          notes: str('Replaces the existing note'),
        },
        required: ['id'],
      },
    },
    run: async ({ id, ...rest }) => {
      const data: any = {}
      for (const [k, v] of Object.entries(rest)) if (v !== undefined && v !== null) data[k] = v
      if (data.reorderThreshold !== undefined) data.reorderThreshold = String(data.reorderThreshold)
      return db.component.update({ where: { id }, data, select: { id: true, name: true } })
    },
  },

  update_product: {
    def: {
      name: 'update_product',
      description: 'Change a product: production lead time, status, retail price, notes.',
      input_schema: {
        type: 'object',
        properties: {
          id: str('Product id'),
          productionLeadTimeDays: num('CMT turnaround in days'),
          status: { type: 'string', enum: ['DEVELOPMENT','SAMPLING','ACTIVE','SUNSETTED'] },
          retailPriceCents: num('Retail price in cents'),
          notes: str('Replaces the existing note'),
        },
        required: ['id'],
      },
    },
    run: async ({ id, ...rest }) => {
      const data: any = {}
      for (const [k, v] of Object.entries(rest)) if (v !== undefined && v !== null) data[k] = v
      return db.product.update({ where: { id }, data, select: { id: true, name: true } })
    },
  },

  upsert_bom_line: {
    def: {
      name: 'upsert_bom_line',
      description:
        'Set how much of a component goes into one unit of a product. Only when you have ' +
        'been given a real figure — never an estimate.',
      input_schema: {
        type: 'object',
        properties: {
          productId: str('Product id'),
          componentId: str('Component id'),
          qtyPerUnit: num('Quantity per finished unit'),
          notes: str('Where the figure came from'),
        },
        required: ['productId', 'componentId', 'qtyPerUnit'],
      },
    },
    run: async (i) => {
      const existing = await db.bomLine.findFirst({
        where: { parentProductId: i.productId, componentId: i.componentId },
      })
      const data = {
        parentProductId: i.productId, componentId: i.componentId,
        qtyPerUnit: String(i.qtyPerUnit), notes: i.notes ?? null,
      }
      return existing
        ? db.bomLine.update({ where: { id: existing.id }, data, select: { id: true } })
        : db.bomLine.create({ data, select: { id: true } })
    },
  },

  query_status: {
    def: {
      name: 'query_status',
      description:
        'Look up detail not in your context: the event ledger for something, sales history ' +
        'over a window, or recent inbound email.',
      input_schema: {
        type: 'object',
        properties: {
          what: { type: 'string', enum: ['events', 'sales', 'email'] },
          entityId: str('Component or variant id, for events or sales'),
          days: num('How far back, default 56'),
        },
        required: ['what'],
      },
    },
    run: async (i) => {
      const since = new Date(Date.now() - (i.days ?? 56) * 864e5)
      if (i.what === 'events') {
        return db.inventoryEvent.findMany({
          where: {
            OR: [{ componentId: i.entityId }, { productVariantId: i.entityId }],
            createdAt: { gte: since },
          },
          orderBy: { createdAt: 'desc' }, take: 40,
          select: { id: true, type: true, deltaQty: true, countedQty: true, note: true, createdAt: true },
        })
      }
      if (i.what === 'sales') {
        return db.salesSnapshot.findMany({
          where: { productVariantId: i.entityId, date: { gte: since } },
          orderBy: { date: 'desc' }, take: 90,
          select: { date: true, unitsSold: true },
        })
      }
      return db.inboundEmail.findMany({
        where: { receivedAt: { gte: since } },
        orderBy: { receivedAt: 'desc' }, take: 20,
        select: { id: true, fromAddress: true, toAddress: true, subject: true, text: true, receivedAt: true },
      })
    },
  },

  request_deep_analysis: {
    def: {
      name: 'request_deep_analysis',
      description:
        'Hand this turn to a stronger model. Use for genuinely hard problems — a tangled ' +
        'production sequence, a judgement with competing signals, reasoning across a lot of ' +
        'history. Not for routine logging or lookups. Costs latency, so it should be worth it.',
      input_schema: {
        type: 'object',
        properties: { reason: str('Why this needs more thought') },
        required: ['reason'],
      },
    },
    // Handled by the route, which re-runs the turn on Opus.
    run: async (i) => ({ escalate: true, reason: i.reason }),
  },
}

export const TOOL_DEFS: Anthropic.Tool[] = Object.values(TOOLS).map((t) => t.def)
