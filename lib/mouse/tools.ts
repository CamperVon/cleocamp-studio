import type Anthropic from '@anthropic-ai/sdk'
import { db } from '@/lib/db'

/** A tool definition paired with the code that runs it. */
type Tool = {
  def: Anthropic.Tool
  run: (input: any) => Promise<unknown>
}

const str = (description: string) => ({ type: 'string' as const, description })

/**
 * Inventory writing is OFF unless explicitly switched on.
 *
 * Paused while the studio does its first physical count — anything logged in
 * the meantime would collide with the real numbers. Default-off rather than
 * default-on so forgetting to set it anywhere is the safe failure, not the
 * damaging one.
 *
 * While paused nothing is dropped: the movement is recorded as a todo so it can
 * be applied once counting is done.
 */
export const inventoryWritesEnabled = () => process.env.INVENTORY_WRITES === 'on'
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
    run: async (i) => {
      if (!inventoryWritesEnabled()) {
        const item = await db.actionItem.create({
          data: {
            kind: 'TODO',
            title: `Apply once counting is done: ${i.type.toLowerCase().replace(/_/g, ' ')} ${i.deltaQty}`,
            detail:
              `Studio Mouse was told about this while inventory writing was paused, so it ` +
              `was not applied. ${JSON.stringify(i)}`,
            source: 'CHAT',
          },
          select: { id: true },
        })
        return {
          applied: false,
          reason:
            'Inventory writing is paused until the studio count is done. Recorded as a ' +
            'todo so it can be applied afterwards — tell the user it was noted but not applied.',
          todoId: item.id,
        }
      }
      return writeEvent(i)
    },
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
      if (!inventoryWritesEnabled()) {
        return { applied: false, reason: 'Inventory writing is paused until the studio count is done.' }
      }
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
          stockedInStudio: {
            type: 'boolean' as const,
            description:
              'True if it physically sits in the studio and gets counted (buttons, tags, ' +
              'hardware, packaging). False if it is bought per production run and shipped ' +
              'straight to the manufacturer (all fabric, leather, denim, canvas).',
          },
          purchaseUnit: str('How it is bought, e.g. roll or hide'),
          unitsPerPurchaseUnit: num('How many consumption units per purchase unit'),
          notes: str('Replaces the existing note'),
        },
        required: ['id'],
      },
    },
    run: async ({ id, ...rest }) => {
      const data: any = {}
      for (const [k, v] of Object.entries(rest)) if (v !== undefined && v !== null) data[k] = v
      if (data.reorderThreshold !== undefined) data.reorderThreshold = String(data.reorderThreshold)
      if (data.unitsPerPurchaseUnit !== undefined) data.unitsPerPurchaseUnit = String(data.unitsPerPurchaseUnit)
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

  update_vendor: {
    def: {
      name: 'update_vendor',
      description:
        'Change a vendor: address, contact, phone, ordering method, payment terms, ' +
        'turnaround. Use this rather than writing a note — a note cannot be forecast from.',
      input_schema: {
        type: 'object',
        properties: {
          id: str('Vendor id'),
          legalName: str('Registered business name'),
          contactName: str('Who you deal with'),
          contactInfo: str('Phone or email'),
          address: str('Street address'),
          orderMethod: str('How orders are placed'),
          paymentTerms: str('e.g. COD, Net 30'),
          leadTimeDays: num('Turnaround in days. For a range, record the longer end.'),
          active: { type: 'boolean' as const, description: 'False when replaced' },
          notes: str('Replaces the existing note'),
        },
        required: ['id'],
      },
    },
    run: async ({ id, ...rest }) => {
      const data: any = {}
      for (const [k, v] of Object.entries(rest)) if (v !== undefined && v !== null) data[k] = v
      return db.vendor.update({ where: { id }, data, select: { id: true, name: true } })
    },
  },

  create_vendor: {
    def: {
      name: 'create_vendor',
      description:
        'Add a supplier, manufacturer or dye house. When one replaces another, create the ' +
        'new one and mark the old inactive — never copy the old prices or lead times across. ' +
        'They are unknown until someone says otherwise.',
      input_schema: {
        type: 'object',
        properties: {
          name: str('What Cleo calls them'),
          role: { type: 'string' as const, enum: ['COMPONENT_SUPPLIER', 'MANUFACTURER', 'DYE_HOUSE', 'OTHER'] },
          legalName: str('Registered name'), contactName: str('Contact'),
          contactInfo: str('Phone or email'), address: str('Address'),
          orderMethod: str('How to order'), leadTimeDays: num('Turnaround in days'),
          notes: str('Anything else'),
        },
        required: ['name', 'role'],
      },
    },
    run: async (i) => db.vendor.create({ data: i, select: { id: true, name: true } }),
  },

  create_component: {
    def: {
      name: 'create_component',
      description: 'Add a material, trim, hardware item or packaging supply.',
      input_schema: {
        type: 'object',
        properties: {
          name: str('What Cleo calls it'),
          category: { type: 'string' as const, enum: ['MATERIAL', 'TRIM', 'HARDWARE', 'PACKAGING', 'SUBASSEMBLY'] },
          unitOfMeasure: str('How it is used, e.g. yard, button, tag'),
          stockedInStudio: { type: 'boolean' as const, description: 'False for anything shipped straight to the manufacturer' },
          vendorId: str('Supplier'), vendorSku: str("Vendor's style number"),
          unitCostCents: num('Price in cents'), leadTimeDays: num('Days to arrive'),
          purchaseUnit: str('How it is bought'), notes: str('Anything else'),
        },
        required: ['name', 'category', 'unitOfMeasure'],
      },
    },
    run: async (i) => db.component.create({ data: i, select: { id: true, name: true } }),
  },

  create_product: {
    def: {
      name: 'create_product',
      description:
        'Add a product. Afterwards, raise questions for whatever is still missing — ' +
        'components and quantities, manufacturer, dye house, lead times, colourways, sizes, ' +
        'retail price. Ask over time rather than all at once.',
      input_schema: {
        type: 'object',
        properties: {
          name: str('Product name'),
          status: { type: 'string' as const, enum: ['DEVELOPMENT', 'SAMPLING', 'ACTIVE', 'SUNSETTED'] },
          retailPriceCents: num('Retail price in cents'),
          productionLeadTimeDays: num('Cut-and-sew turnaround in days'),
          notes: str('Anything else'),
        },
        required: ['name'],
      },
    },
    run: async (i) => db.product.create({ data: i, select: { id: true, name: true } }),
  },

  create_colorway: {
    def: {
      name: 'create_colorway',
      description:
        'Add a colour. Record both names where they differ — customers see "Shell", the dye ' +
        'house calls it "Shrinking Violet", and using the wrong one with Martin wastes a call.',
      input_schema: {
        type: 'object',
        properties: {
          productId: str('Product id'),
          customerName: str('What customers see'),
          dyeHouseName: str('What the dye house calls it'),
          pantone: str('Pantone reference'),
          inHouseMatch: { type: 'boolean' as const, description: 'True when matched in-house with no dye house name' },
        },
        required: ['productId', 'customerName'],
      },
    },
    run: async (i) => db.colorway.create({ data: i, select: { id: true, customerName: true } }),
  },

  create_production_run: {
    def: {
      name: 'create_production_run',
      description:
        'Record a production run. Holds no inventory — it exists to track where things are ' +
        'and to chain lead times. Set dateConfirmed false when the maker has not confirmed.',
      input_schema: {
        type: 'object',
        properties: {
          productId: str('Product id'), vendorId: str('The manufacturer'),
          cutRef: str("The maker's own reference, e.g. Cut #14"),
          status: { type: 'string' as const, enum: ['PLANNED','COMPONENTS_ORDERED','IN_PRODUCTION','AT_DYE_HOUSE','FINISHING','READY_FOR_PICKUP'] },
          expectedReadyAt: str('ISO date'),
          dateConfirmed: { type: 'boolean' as const, description: 'Has the maker confirmed it' },
          notes: str('Anything else'),
        },
        required: ['productId'],
      },
    },
    run: async (i) =>
      db.productionRun.create({
        data: { ...i, expectedReadyAt: i.expectedReadyAt ? new Date(i.expectedReadyAt + 'T12:00:00-07:00') : null },
        select: { id: true },
      }),
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
