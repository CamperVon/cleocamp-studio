/**
 * Live sales, invoiced through Shopify. Brandon, 27 Sept 2026: "please invoice
 * jane doe for a boy belt size m. mouse will deduct the inventory and send the
 * invoice ... so it can be paid directly to us. (these are for live sales.)"
 *
 * Shopify, not QuickBooks, on purpose. Shopify is the master for finished
 * goods (CLAUDE.md §3), so a Shopify order takes the item off stock by itself
 * and the nightly sync carries that into the ledger — no second count to keep
 * in step, and nothing here writes an InventoryEvent (that would count the
 * sale twice). The sale also lands in the sales history the forecast reads,
 * and flows to QuickBooks through the existing Shopify sync. The app's own
 * QuickBooks connection stays dormant, as decided on 12 Sept.
 *
 * The flow, only ever on a person's say-so in the chat:
 *   1. a draft order at the retail price (or a price the person named);
 *   2. completed as an unpaid order — the item leaves stock now, because it
 *      left the table now;
 *   3. marked handed over (fulfilled), so it never reaches the packing list;
 *   4. Shopify emails the customer the invoice, with a link to pay.
 * Tax is Shopify's own: with no address it charges the shop's (LA, 9.75%),
 * which is right for a sale made in person there.
 */
import { shopifyGraphQL } from '@/lib/integrations/shopify'

/**
 * One line. With stock: the real Shopify variant, so the order takes it off
 * stock. Without: a plain line with the same name and price and no product
 * link, which Shopify never counts against stock — for goods that did not
 * come out of the studio's stock (shipped from a maker, or already counted
 * out). A line without stock must carry its price.
 */
export type SaleLine = { shopifyVariantId: string; label: string; quantity: number; priceOverride?: number | null; noStock?: boolean }

/** How the invoice is made: the retail live sale is the default. */
export type InvoiceOptions = {
  /** Wholesale: the store resells, so no sales tax. */
  taxExempt?: boolean
  tags?: string[]
  subject?: (orderName: string) => string
  message?: (firstName: string) => string
  /**
   * Shipped rather than handed over: the address goes on the order and it is
   * left unfulfilled, so Shopify offers "Create shipping label" on it.
   */
  shipTo?: ShipAddress
  /** A shipping charge, only when a person named one or a rule sets it. */
  shippingCharge?: number | null
  shippingTitle?: string
  /**
   * Who the order is for, by name and address, when it is not shipped: a
   * store the goods were handed to still has a name and an address, and the
   * draft read "No name provided" without them (Brandon, 28 Sept 2026, #D36).
   */
  billTo?: ShipAddress
  /** The Shopify customer, so the draft and order show their name. */
  customerId?: string | null
  /**
   * A percentage off the whole order, worked out by Shopify from its own
   * prices and shown on the invoice as a named discount. Mouse once took 20%
   * off the wrong retail price by hand (#2643, 28 Sept 2026); Shopify
   * cannot make that mistake.
   */
  discount?: { percent: number; title: string } | null
  /** Extra people to copy (blind) on the invoice email, beyond the studio. */
  bcc?: string[]
}

/**
 * Wholesale shipping & handling: a flat $25 on a shipped order, waived when
 * the goods come to over $2,500 (Brandon, 28 Sept 2026; the same terms he gave
 * Cosimo on 24 Sept: "a flat $25 packing and shipping fees for domestic
 * orders under $2500"). A charge a person names for one invoice wins. Pure.
 */
export const WHOLESALE_SHIPPING = 25
export const WHOLESALE_FREE_SHIPPING_OVER = 2500
export function wholesaleShipping(goodsSubtotal: number, named: number | null | undefined): { charge: number; title: string; why: string } {
  if (named != null) return { charge: named, title: 'Shipping & handling', why: 'as named for this invoice' }
  if (goodsSubtotal > WHOLESALE_FREE_SHIPPING_OVER) return { charge: 0, title: 'Shipping & handling (waived over $2,500)', why: 'waived, order over $2,500' }
  return { charge: WHOLESALE_SHIPPING, title: 'Shipping & handling', why: 'flat $25, order under $2,500' }
}

export type ShipAddress = {
  company?: string | null
  firstName?: string | null
  lastName?: string | null
  address1: string
  address2?: string | null
  city: string
  provinceCode: string
  zip: string
  countryCode: 'US'
}

const STATES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT',
  delaware: 'DE', 'district of columbia': 'DC', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL',
  indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT',
  nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA',
  'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT',
  vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
}

/**
 * A US address written on one line — "2030 Hillhurst Ave, Los Angeles,
 * California 90027" — split into the parts a label needs. Anything it cannot
 * read with certainty (no ZIP, no state, no street number) is null, and the
 * person is asked for the full address; a label to a guessed address is a
 * parcel lost. Pure.
 */
export function parseUsAddress(line: string | null | undefined): Omit<ShipAddress, 'company' | 'firstName' | 'lastName'> | null {
  const parts = (line ?? '').replace(/\s*\n\s*/g, ', ').split(',').map((p) => p.trim()).filter(Boolean)
  if (parts.length && /^(usa?|united states( of america)?)$/i.test(parts[parts.length - 1])) parts.pop()
  if (parts.length < 3) return null
  const m = parts[parts.length - 1].match(/^([A-Za-z .]+?)\s+(\d{5})(?:-\d{4})?$/)
  if (!m) return null
  const st = m[1].trim().replace(/\./g, '')
  const provinceCode = /^[A-Za-z]{2}$/.test(st) ? st.toUpperCase() : STATES[st.toLowerCase()]
  if (!provinceCode || !Object.values(STATES).includes(provinceCode)) return null
  const city = parts[parts.length - 2]
  const street = parts.slice(0, -2)
  if (!/^\d/.test(street[0] ?? '') || /\d/.test(city)) return null
  return { address1: street[0], address2: street.slice(1).join(', ') || null, city, provinceCode, zip: m[2], countryCode: 'US' }
}

/** The address as it will print on the label, for a person to check. Pure. */
export function addressLines(a: ShipAddress): string {
  const who = [a.company, [a.firstName, a.lastName].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  return [who, a.address1, a.address2, `${a.city}, ${a.provinceCode} ${a.zip}`].filter(Boolean).join(' / ')
}

/** The shop's own email in Shopify: what invoices come from and copy to. */
export const INVOICE_FROM = 'studio@cleocamp.com'

type Money = { shopMoney: { amount: string } }
const gid = (id: string) => (id.startsWith('gid://') ? id : `gid://shopify/ProductVariant/${id}`)
const money = (m: Money | null | undefined) => Number(m?.shopMoney.amount ?? 0)

function draftInput(email: string, lines: SaleLine[], note: string, opts: InvoiceOptions = {}) {
  return {
    // A gift can have no email: nobody is invoiced.
    ...(email ? { email } : {}),
    note,
    tags: opts.tags ?? ['live-sale', 'studio-mouse'],
    // Always said, never left out: a revised draft keeps its old setting otherwise,
    // so a wholesale draft redone "with sales tax" would stay tax exempt.
    taxExempt: !!opts.taxExempt,
    ...(opts.shipTo ?? opts.billTo ? { shippingAddress: opts.shipTo ?? opts.billTo, billingAddress: opts.billTo ?? opts.shipTo } : {}),
    ...(opts.customerId ? { purchasingEntity: { customerId: opts.customerId } } : {}),
    ...(opts.discount ? { appliedDiscount: { value: opts.discount.percent, valueType: 'PERCENTAGE', title: opts.discount.title } } : {}),
    ...(opts.shippingCharge != null
      ? { shippingLine: { title: opts.shippingTitle ?? 'Shipping', priceWithCurrency: { amount: opts.shippingCharge.toFixed(2), currencyCode: 'USD' } } }
      : {}),
    lineItems: lines.map((l) => {
      const price = l.priceOverride != null ? { amount: l.priceOverride.toFixed(2), currencyCode: 'USD' } : null
      if (l.noStock) {
        if (!price) throw new Error(`${l.label} has no price. A line that leaves stock alone needs one.`)
        return { title: l.label, quantity: l.quantity, originalUnitPriceWithCurrency: price, taxable: !opts.taxExempt, requiresShipping: true }
      }
      return { variantId: gid(l.shopifyVariantId), quantity: l.quantity, ...(price ? { priceOverride: price } : {}) }
    }),
  }
}

export type Quote = {
  /** shopifyPrice: what Shopify itself sells the variant for, to check a named price against. */
  lines: Array<{ label: string; quantity: number; unitPrice: number; priced: 'retail' | 'named'; shopifyPrice: number | null }>
  subtotal: number
  /** Taken off by an order discount (Friends and Family); subtotal is after it. */
  discount: number
  shipping: number
  tax: number
  total: number
}

/** What the invoice will say, worked out by Shopify. Creates nothing. */
export async function quoteLiveSale(email: string, lines: SaleLine[], opts: InvoiceOptions = {}): Promise<Quote> {
  const d = await shopifyGraphQL<{ draftOrderCalculate: { calculatedDraftOrder: {
    subtotalPriceSet: Money; totalDiscountsSet: Money; totalShippingPriceSet: Money; totalTaxSet: Money; totalPriceSet: Money
    lineItems: Array<{ quantity: number; originalUnitPriceSet: Money; discountedUnitPriceSet?: Money }>
  } | null; userErrors: Array<{ message: string }> } }>(
    `mutation($input: DraftOrderInput!) { draftOrderCalculate(input: $input) { calculatedDraftOrder {
      subtotalPriceSet { shopMoney { amount } } totalDiscountsSet { shopMoney { amount } } totalShippingPriceSet { shopMoney { amount } } totalTaxSet { shopMoney { amount } } totalPriceSet { shopMoney { amount } }
      lineItems { quantity originalUnitPriceSet { shopMoney { amount } } }
    } userErrors { message } } }`,
    { input: draftInput(email, lines, '', opts) },
  )
  const c = d.draftOrderCalculate.calculatedDraftOrder
  if (!c) throw new Error(d.draftOrderCalculate.userErrors.map((e) => e.message).join('; ') || 'Shopify could not price this.')
  // Shopify's own price for every real variant, straight from Shopify: the
  // app's stored retail can be the product's, not the size's (the Bean Bag
  // is $398 in Medium, $368 in Petite), and #2643 went out priced off it.
  const ids = lines.filter((l) => !l.noStock && l.shopifyVariantId).map((l) => gid(l.shopifyVariantId))
  const shopPrice = new Map<string, number>()
  if (ids.length) {
    const p = await shopifyGraphQL<{ nodes: Array<{ id?: string; price?: string } | null> }>(
      `query($ids: [ID!]!) { nodes(ids: $ids) { ... on ProductVariant { id price } } }`,
      { ids },
    )
    for (const n of p.nodes) if (n?.id && n.price != null) shopPrice.set(n.id, Number(n.price))
  }
  return {
    lines: lines.map((l, i) => ({
      label: l.label,
      quantity: l.quantity,
      unitPrice: l.priceOverride ?? money(c.lineItems[i]?.originalUnitPriceSet),
      priced: l.priceOverride != null ? 'named' : 'retail',
      shopifyPrice: l.noStock ? null : shopPrice.get(gid(l.shopifyVariantId)) ?? null,
    })),
    subtotal: money(c.subtotalPriceSet),
    discount: money(c.totalDiscountsSet),
    shipping: money(c.totalShippingPriceSet),
    tax: money(c.totalTaxSet),
    total: money(c.totalPriceSet),
  }
}

export type InvoiceResult = {
  orderName: string | null
  orderId: string | null
  total: number | null
  fulfilled: boolean
  invoiceSent: boolean
  /** Anything that did not happen, in words for the person, with what to do. */
  problems: string[]
  /** Who got the team's copy (our own email, with the invoice PDF). */
  copiedTo?: string[]
}

/**
 * The team's copy of an invoice: our own email, not Shopify's, with the
 * invoice as a PDF, to any address at all. Also used on its own to re-send a
 * copy of an invoice that has already gone.
 */
export async function emailInvoiceCopy(draftId: string, to: string[], customerEmail: string): Promise<{ sent: boolean; to: string[]; reason?: string }> {
  const recipients = [...new Set(to.map((t) => t.trim().toLowerCase()).filter(Boolean))]
  try {
    const { renderDraftPdf } = await import('@/lib/draft-pdf')
    const { sendEmail } = await import('@/lib/email')
    const r = await renderDraftPdf(draftId.split('/').pop() ?? draftId)
    if (!r) return { sent: false, to: recipients, reason: 'the draft is no longer in Shopify' }
    const res = await sendEmail({
      to: recipients,
      replyTo: INVOICE_FROM,
      subject: `Copy: Cleo Camp invoice ${r.name} to ${customerEmail}`,
      text: `For the team: this is a copy of invoice ${r.name}, which Shopify emailed to ${customerEmail} with a link to pay. The invoice is attached as a PDF.\n\nStudio Mouse`,
      attachments: [{ filename: `Invoice-${r.name.replace(/[^A-Za-z0-9]/g, '')}.pdf`, content: r.pdf }],
    })
    return res.sent ? { sent: true, to: recipients } : { sent: false, to: recipients, reason: 'reason' in res ? String(res.reason) : 'the email did not send' }
  } catch (e) {
    return { sent: false, to: recipients, reason: e instanceof Error ? e.message.slice(0, 160) : String(e) }
  }
}

type DraftCreated = { draftOrderCreate: { draftOrder: { id: string } | null; userErrors: Array<{ message: string }> } }

/**
 * Create, hand over and invoice. Stops at the first step that fails and says
 * exactly what state that leaves, so nothing half-done goes unmentioned.
 */
export async function invoiceLiveSale(args: {
  email: string
  customerName: string
  lines: SaleLine[]
  note: string
  options?: InvoiceOptions
}): Promise<InvoiceResult> {
  const opts = args.options ?? {}
  const created = await shopifyGraphQL<DraftCreated>(
    `mutation($input: DraftOrderInput!) { draftOrderCreate(input: $input) { draftOrder { id } userErrors { message } } }`,
    { input: draftInput(args.email, args.lines, args.note, opts) },
  )
  const draftId = created.draftOrderCreate.draftOrder?.id
  if (!draftId) {
    return { orderName: null, orderId: null, total: null, fulfilled: false, invoiceSent: false, problems: [
      `Shopify would not create the order: ${created.draftOrderCreate.userErrors.map((e) => e.message).join('; ') || 'no reason given'}. Nothing was created, charged or sent.`,
    ] }
  }
  return completeAndInvoice(draftId, args.email, args.customerName, opts)
}

/**
 * Turn a draft into an unpaid order, mark it handed over unless it ships, and
 * email the invoice. Shared by the live sale (draft made a moment ago) and a
 * wholesale draft someone has reviewed in Shopify first.
 */
async function completeAndInvoice(draftId: string, email: string, customerName: string, opts: InvoiceOptions): Promise<InvoiceResult> {
  const out: InvoiceResult = { orderName: null, orderId: null, total: null, fulfilled: false, invoiceSent: false, problems: [] }

  // Unpaid order: stock leaves now, payment follows through the invoice.
  const done = await shopifyGraphQL<{ draftOrderComplete: { draftOrder: { order: { id: string; name: string; totalPriceSet: Money } | null } | null; userErrors: Array<{ message: string }> } }>(
    `mutation($id: ID!) { draftOrderComplete(id: $id, paymentPending: true) { draftOrder { order { id name totalPriceSet { shopMoney { amount } } } } userErrors { message } } }`,
    { id: draftId },
  )
  const order = done.draftOrderComplete.draftOrder?.order
  if (!order) {
    out.problems.push(`The draft order was made but Shopify would not turn it into an order: ${done.draftOrderComplete.userErrors.map((e) => e.message).join('; ') || 'no reason given'}. Stock has not moved and nothing was sent; the draft is under Orders → Drafts in Shopify.`)
    return out
  }
  out.orderId = order.id
  out.orderName = order.name
  out.total = money(order.totalPriceSet)

  // Handed over at the table, so it must never reach the packing list.
  // Fulfillment orders appear a moment after the order does. A shipped order
  // is left unfulfilled: that is what puts "Create shipping label" on it.
  let fulfillmentOrderIds: string[] = []
  for (let i = 0; i < 5 && !opts.shipTo && !fulfillmentOrderIds.length; i++) {
    const fo = await shopifyGraphQL<{ order: { fulfillmentOrders: { nodes: Array<{ id: string; status: string }> } } | null }>(
      `query($id: ID!) { order(id: $id) { fulfillmentOrders(first: 5) { nodes { id status } } } }`,
      { id: order.id },
    )
    fulfillmentOrderIds = (fo.order?.fulfillmentOrders.nodes ?? []).filter((n) => n.status === 'OPEN').map((n) => n.id)
    if (!fulfillmentOrderIds.length) await new Promise((r) => setTimeout(r, 800))
  }
  if (opts.shipTo) {
    // Nothing to mark: it goes out with a label.
  } else if (fulfillmentOrderIds.length) {
    const f = await shopifyGraphQL<{ fulfillmentCreate: { fulfillment: { id: string } | null; userErrors: Array<{ message: string }> } }>(
      `mutation($f: FulfillmentInput!) { fulfillmentCreate(fulfillment: $f) { fulfillment { id } userErrors { message } } }`,
      { f: { notifyCustomer: false, lineItemsByFulfillmentOrder: fulfillmentOrderIds.map((id) => ({ fulfillmentOrderId: id })) } },
    )
    out.fulfilled = !!f.fulfillmentCreate.fulfillment
    if (!out.fulfilled) out.problems.push(`${order.name} was not marked handed over (${f.fulfillmentCreate.userErrors.map((e) => e.message).join('; ') || 'no reason given'}). Mark it fulfilled in Shopify, or it will show up to be packed and shipped.`)
  } else {
    out.problems.push(`${order.name} was not marked handed over — Shopify had nothing to fulfil yet. Mark it fulfilled in Shopify, or it will show up to be packed and shipped.`)
  }

  const first = customerName.trim().split(/\s+/)[0]
  const base = {
    to: email,
    subject: opts.subject ? opts.subject(order.name) : `Your Cleo Camp invoice ${order.name}`,
    customMessage: opts.message ? opts.message(first) : `Hi ${first}, thank you for shopping with us in person. You can pay securely using the link below.\n\nKindly,\nCleo Studio`,
  }
  const send = (e: Record<string, unknown>) => shopifyGraphQL<{ orderInvoiceSend: { order: { id: string } | null; userErrors: Array<{ message: string }> } }>(
    `mutation($id: ID!, $email: EmailInput) { orderInvoiceSend(id: $id, email: $email) { order { id } userErrors { message } } }`,
    { id: order.id, email: e },
  )
  // From the studio, so a reply reaches a person. Cleo, 28 Sept 2026: "Is
  // there a way that I can be cc'd on it so we can keep the human
  // communication going?" The team's copy is NOT Shopify's bcc: Shopify only
  // allows its own staff accounts there, and on #2644 it refused jane@ and
  // took studio@ down with it. The copy is our own email instead (below). If
  // Shopify refuses the sender, the invoice still goes, from Shopify's own.
  let sent = await send({ ...base, from: INVOICE_FROM })
  if (!sent.orderInvoiceSend.order || sent.orderInvoiceSend.userErrors.length) sent = await send(base)
  out.invoiceSent = !!sent.orderInvoiceSend.order && !sent.orderInvoiceSend.userErrors.length
  if (out.invoiceSent) {
    const copy = await emailInvoiceCopy(draftId, [INVOICE_FROM, ...(opts.bcc ?? [])], email)
    out.copiedTo = copy.sent ? copy.to : []
    if (!copy.sent) out.problems.push(`The invoice went, but the team's copy did not (${copy.reason}). Ask Mouse to email the copy of ${order.name} again.`)
  }
  if (!out.invoiceSent) out.problems.push(`The invoice email did not go (${sent.orderInvoiceSend.userErrors.map((e) => e.message).join('; ') || 'no reason given'}). Open ${order.name} in Shopify and use "Send invoice".`)
  return out
}

/**
 * An invoice for goods that ship. Brandon, 1 Oct 2026: "We are going to be
 * sending some invoices to people around the country with items to be
 * shipped. When they pay it should be handled as normal from Shopify.
 * Inventory deduction and shipping label." The live sale above completes the
 * order at once and marks it handed over, which is right only when the goods
 * left the table; on a shipped sale it took away the label.
 *
 * So this stays a draft and Shopify emails its invoice. She checks out like
 * any customer: her address, Shopify's shipping rates, tax for where it is
 * going. Only when she pays does Shopify make the order, take the stock and
 * leave it unfulfilled, waiting for "Create shipping label". An address a
 * person gave goes on the draft so she finds it filled in.
 */
export async function invoiceToShip(args: {
  email: string
  customerName: string
  lines: SaleLine[]
  note: string
  options?: InvoiceOptions
}): Promise<{ draftId: string | null; draftName: string | null; invoiceSent: boolean; copiedTo: string[]; problems: string[] }> {
  const [firstName, ...rest] = args.customerName.trim().split(/\s+/)
  const who = await storeCustomer(args.email, { firstName, lastName: rest.join(' ') || null }, ['studio-mouse'])
  const opts: InvoiceOptions = { ...(args.options ?? {}), tags: ['invoice', 'studio-mouse'], customerId: who.id }
  const created = await shopifyGraphQL<{ draftOrderCreate: { draftOrder: { id: string; name: string } | null; userErrors: Array<{ message: string }> } }>(
    `mutation($input: DraftOrderInput!) { draftOrderCreate(input: $input) { draftOrder { id name } userErrors { message } } }`,
    { input: draftInput(args.email, args.lines, args.note, opts) },
  )
  const d = created.draftOrderCreate.draftOrder
  if (!d) return { draftId: null, draftName: null, invoiceSent: false, copiedTo: [], problems: [`Shopify would not create the invoice: ${created.draftOrderCreate.userErrors.map((e) => e.message).join('; ') || 'no reason given'}. Nothing was created or sent.`] }
  const base = {
    to: args.email,
    subject: opts.subject ? opts.subject(d.name) : 'Your Cleo Camp invoice',
    customMessage: opts.message ? opts.message(firstName) : `Hi ${firstName}, here is your Cleo Camp invoice. Tap the link below to add your address and pay securely, and we will ship it to you.\n\nKindly,\nCleo Studio`,
  }
  const send = (e: Record<string, unknown>) => shopifyGraphQL<{ draftOrderInvoiceSend: { draftOrder: { id: string } | null; userErrors: Array<{ message: string }> } }>(
    `mutation($id: ID!, $email: EmailInput) { draftOrderInvoiceSend(id: $id, email: $email) { draftOrder { id } userErrors { message } } }`,
    { id: d.id, email: e },
  )
  let r = await send({ ...base, from: INVOICE_FROM })
  if (!r.draftOrderInvoiceSend.draftOrder || r.draftOrderInvoiceSend.userErrors.length) r = await send(base)
  const invoiceSent = !!r.draftOrderInvoiceSend.draftOrder && !r.draftOrderInvoiceSend.userErrors.length
  const problems: string[] = who.problem ? [`No Shopify customer was attached (${who.problem}); the invoice still carries her email.`] : []
  let copiedTo: string[] = []
  if (invoiceSent) {
    const copy = await emailInvoiceCopy(d.id, [INVOICE_FROM, ...(opts.bcc ?? [])], args.email)
    copiedTo = copy.sent ? copy.to : []
    if (!copy.sent) problems.push(`The invoice went, but the team's copy did not (${copy.reason}).`)
  } else {
    problems.push(`The invoice ${d.name} was made but the email did not go (${r.draftOrderInvoiceSend.userErrors.map((e) => e.message).join('; ') || 'no reason given'}). Open ${d.name} under Orders → Drafts in Shopify and use "Send invoice".`)
  }
  return { draftId: d.id, draftName: d.name, invoiceSent, copiedTo, problems }
}

/**
 * The Shopify customer for a store, found by email or made, so an invoice
 * carries the store's name. Only fills a name Shopify has blank; never
 * renames someone. Returns null (and the draft goes out by email alone) if
 * the app may not read or write customers.
 */
export async function storeCustomer(email: string, name: { firstName: string; lastName?: string | null }, tags: string[] = ['wholesale']): Promise<{ id: string | null; problem?: string }> {
  try {
    const found = await shopifyGraphQL<{ customers: { nodes: Array<{ id: string; firstName: string | null; lastName: string | null }> } }>(
      `query($q: String!) { customers(first: 1, query: $q) { nodes { id firstName lastName } } }`,
      { q: `email:"${email.replace(/"/g, '')}"` },
    )
    const c = found.customers.nodes[0]
    if (c) {
      if (!c.firstName && !c.lastName) {
        await shopifyGraphQL(
          `mutation($input: CustomerInput!) { customerUpdate(input: $input) { customer { id } userErrors { message } } }`,
          { input: { id: c.id, firstName: name.firstName, lastName: name.lastName ?? null } },
        )
      }
      return { id: c.id }
    }
    const made = await shopifyGraphQL<{ customerCreate: { customer: { id: string } | null; userErrors: Array<{ message: string }> } }>(
      `mutation($input: CustomerInput!) { customerCreate(input: $input) { customer { id } userErrors { message } } }`,
      { input: { email, firstName: name.firstName, lastName: name.lastName ?? null, tags } },
    )
    return made.customerCreate.customer
      ? { id: made.customerCreate.customer.id }
      : { id: null, problem: made.customerCreate.userErrors.map((e) => e.message).join('; ') }
  } catch (e) {
    return { id: null, problem: e instanceof Error ? e.message.slice(0, 160) : String(e) }
  }
}

let shopHandle: string | null = null
/** Where a person opens a draft order in Shopify admin. */
async function draftAdminUrl(legacyId: string): Promise<string> {
  if (!shopHandle) {
    const d = await shopifyGraphQL<{ shop: { myshopifyDomain: string } }>(`{ shop { myshopifyDomain } }`)
    shopHandle = d.shop.myshopifyDomain.replace(/\.myshopify\.com$/, '')
  }
  return `https://admin.shopify.com/store/${shopHandle}/draft_orders/${legacyId}`
}

export type SavedDraft = {
  draftOrderId: string
  name: string
  adminUrl: string
  /** The draft as a PDF in our own app, behind the login, to share inside the studio. */
  pdfPath: string
  lines: Array<{ label: string; quantity: number; unitPrice: number }>
  subtotal: number
  shipping: number
  tax: number
  total: number
}

const DRAFT_FIELDS = `id name legacyResourceId status
  subtotalPriceSet { shopMoney { amount } } totalShippingPriceSet { shopMoney { amount } }
  totalTaxSet { shopMoney { amount } } totalPriceSet { shopMoney { amount } }
  lineItems(first: 100) { nodes { title variantTitle quantity originalUnitPriceSet { shopMoney { amount } } } }`
type DraftShape = {
  id: string; name: string; legacyResourceId: string; status: string
  subtotalPriceSet: Money; totalShippingPriceSet: Money; totalTaxSet: Money; totalPriceSet: Money
  lineItems: { nodes: Array<{ title: string; variantTitle: string | null; quantity: number; originalUnitPriceSet: Money }> }
}

/**
 * A real draft order in Shopify, for people to look over before anything is
 * sent (Brandon, 28 Sept 2026: "spit back the draft or a link to the draft in
 * shopify so that we can review internally"). Nothing leaves stock and nothing
 * is emailed. Given the id of an earlier draft that is still open, it is
 * rewritten in place rather than leaving a second draft behind.
 */
export async function saveDraft(args: { email: string; lines: SaleLine[]; note: string; options?: InvoiceOptions; draftOrderId?: string | null }): Promise<SavedDraft> {
  const input = draftInput(args.email, args.lines, args.note, args.options ?? {})
  let d: DraftShape | null = null
  let errors: Array<{ message: string }> = []
  if (args.draftOrderId) {
    const cur = await shopifyGraphQL<{ draftOrder: { status: string } | null }>(`query($id: ID!) { draftOrder(id: $id) { status } }`, { id: args.draftOrderId })
    if (cur.draftOrder && cur.draftOrder.status !== 'COMPLETED') {
      const u = await shopifyGraphQL<{ draftOrderUpdate: { draftOrder: DraftShape | null; userErrors: Array<{ message: string }> } }>(
        `mutation($id: ID!, $input: DraftOrderInput!) { draftOrderUpdate(id: $id, input: $input) { draftOrder { ${DRAFT_FIELDS} } userErrors { message } } }`,
        { id: args.draftOrderId, input },
      )
      d = u.draftOrderUpdate.draftOrder
      errors = u.draftOrderUpdate.userErrors
    }
  }
  if (!d && !errors.length) {
    const c = await shopifyGraphQL<{ draftOrderCreate: { draftOrder: DraftShape | null; userErrors: Array<{ message: string }> } }>(
      `mutation($input: DraftOrderInput!) { draftOrderCreate(input: $input) { draftOrder { ${DRAFT_FIELDS} } userErrors { message } } }`,
      { input },
    )
    d = c.draftOrderCreate.draftOrder
    errors = c.draftOrderCreate.userErrors
  }
  if (!d) throw new Error(errors.map((e) => e.message).join('; ') || 'Shopify would not save the draft.')
  return {
    draftOrderId: d.id,
    name: d.name,
    adminUrl: await draftAdminUrl(d.legacyResourceId),
    pdfPath: `/drafts/${d.legacyResourceId}/pdf`,
    lines: d.lineItems.nodes.map((l) => ({ label: `${l.title}${l.variantTitle ? ` — ${l.variantTitle}` : ''}`, quantity: l.quantity, unitPrice: money(l.originalUnitPriceSet) })),
    subtotal: money(d.subtotalPriceSet),
    shipping: money(d.totalShippingPriceSet),
    tax: money(d.totalTaxSet),
    total: money(d.totalPriceSet),
  }
}

/**
 * Send a reviewed draft: exactly what is in Shopify now, edits made there
 * included. Refuses a draft that is already an order, or that is not ours for
 * this purpose (its tag), so a stale id can never invoice the wrong thing.
 */
export async function sendDraft(args: { draftOrderId: string; email: string; customerName: string; requireTag: string; options?: InvoiceOptions }): Promise<InvoiceResult> {
  const blank: InvoiceResult = { orderName: null, orderId: null, total: null, fulfilled: false, invoiceSent: false, problems: [] }
  const d = await shopifyGraphQL<{ draftOrder: { name: string; status: string; tags: string[]; order: { name: string } | null } | null }>(
    `query($id: ID!) { draftOrder(id: $id) { name status tags order { name } } }`,
    { id: args.draftOrderId },
  )
  const dr = d.draftOrder
  if (!dr) return { ...blank, problems: ['That draft is no longer in Shopify (deleted?). Nothing was sent. Draft it again.'] }
  if (dr.status === 'COMPLETED' || dr.order) return { ...blank, orderName: dr.order?.name ?? null, problems: [`${dr.name} has already been turned into order ${dr.order?.name ?? ''}. Nothing new was sent.`] }
  if (!dr.tags.includes(args.requireTag)) return { ...blank, problems: [`${dr.name} is not a ${args.requireTag} draft. Nothing was sent.`] }
  return completeAndInvoice(args.draftOrderId, args.email, args.customerName, args.options ?? {})
}

export type DraftSummary = {
  id: string
  name: string
  open: boolean
  tags: string[]
  email: string | null
  company: string | null
  address: ShipAddress | null
  lines: Array<{ label: string; quantity: number; unitPrice: number; fromStock: boolean }>
  subtotal: number
  shipping: number
  tax: number
  total: number
  pdfPath: string
  adminUrl: string
}

/**
 * A draft by its number ("D36"), read back from Shopify in full, so it can be
 * shown and sent as it stands. Brandon, 28 Sept 2026, asking Mouse to process
 * #D36: Mouse asked him for the items, because the only way to send was to
 * rebuild the draft from a list it no longer had. Shopify's search does not
 * match draft names exactly, so the recent ones are read and matched here.
 */
export async function findDraft(nameIn: string): Promise<DraftSummary | null> {
  const want = `#${nameIn.replace(/^#/, '').trim().toUpperCase()}`
  const list = await shopifyGraphQL<{ draftOrders: { nodes: Array<{ id: string; name: string }> } }>(
    `{ draftOrders(first: 100, reverse: true) { nodes { id name } } }`,
  )
  const hit = list.draftOrders.nodes.find((n) => n.name.toUpperCase() === want)
  if (!hit) return null
  type A = { company: string | null; firstName: string | null; lastName: string | null; address1: string | null; address2: string | null; city: string | null; provinceCode: string | null; zip: string | null } | null
  const d = await shopifyGraphQL<{ draftOrder: {
    id: string; name: string; status: string; legacyResourceId: string; tags: string[]; email: string | null
    shippingAddress: A; billingAddress: A
    lineItems: { nodes: Array<{ title: string; variantTitle: string | null; quantity: number; variant: { id: string } | null; originalUnitPriceSet: Money }> }
    subtotalPriceSet: Money; totalShippingPriceSet: Money; totalTaxSet: Money; totalPriceSet: Money
  } | null }>(
    `query($id: ID!) { draftOrder(id: $id) { id name status legacyResourceId tags email
      shippingAddress { company firstName lastName address1 address2 city provinceCode zip }
      billingAddress { company firstName lastName address1 address2 city provinceCode zip }
      lineItems(first: 250) { nodes { title variantTitle quantity variant { id } originalUnitPriceSet { shopMoney { amount } } } }
      subtotalPriceSet { shopMoney { amount } } totalShippingPriceSet { shopMoney { amount } } totalTaxSet { shopMoney { amount } } totalPriceSet { shopMoney { amount } } } }`,
    { id: hit.id },
  )
  const o = d.draftOrder
  if (!o) return null
  const a = o.shippingAddress ?? o.billingAddress
  return {
    id: o.id, name: o.name, open: o.status !== 'COMPLETED', tags: o.tags, email: o.email,
    company: a?.company ?? null,
    address: a?.address1 && a.city && a.provinceCode && a.zip
      ? { company: a.company, firstName: a.firstName, lastName: a.lastName, address1: a.address1, address2: a.address2, city: a.city, provinceCode: a.provinceCode, zip: a.zip, countryCode: 'US' }
      : null,
    lines: o.lineItems.nodes.map((l) => ({ label: `${l.title}${l.variantTitle ? ` — ${l.variantTitle}` : ''}`, quantity: l.quantity, unitPrice: money(l.originalUnitPriceSet), fromStock: !!l.variant })),
    subtotal: money(o.subtotalPriceSet), shipping: money(o.totalShippingPriceSet), tax: money(o.totalTaxSet), total: money(o.totalPriceSet),
    pdfPath: `/drafts/${o.legacyResourceId}/pdf`,
    adminUrl: await draftAdminUrl(o.legacyResourceId),
  }
}

/** The draft an order was invoiced from ("2644" → its draft id and email). */
export async function draftForOrder(orderNameIn: string): Promise<{ draftId: string; orderName: string; email: string | null } | null> {
  const want = `#${orderNameIn.replace(/^#/, '').trim()}`
  const d = await shopifyGraphQL<{ draftOrders: { nodes: Array<{ id: string; email: string | null; order: { name: string } | null }> } }>(
    `{ draftOrders(first: 100, reverse: true, query: "status:completed") { nodes { id email order { name } } } }`,
  )
  const hit = d.draftOrders.nodes.find((n) => n.order?.name === want)
  return hit ? { draftId: hit.id, orderName: want, email: hit.email } : null
}

/** Invoices still waiting on payment, newest first: live sales, and invoices that ship. */
export async function unpaidLiveSales(): Promise<Array<{ name: string; email: string | null; total: number; createdAt: string; status: string }>> {
  const d = await shopifyGraphQL<{ orders: { nodes: Array<{ name: string; email: string | null; createdAt: string; displayFinancialStatus: string | null; totalPriceSet: Money }> } }>(
    `query { orders(first: 50, sortKey: CREATED_AT, reverse: true, query: "tag:live-sale AND financial_status:pending") { nodes { name email createdAt displayFinancialStatus totalPriceSet { shopMoney { amount } } } } }`,
  )
  const sold = d.orders.nodes.map((o) => ({ name: o.name, email: o.email, total: money(o.totalPriceSet), createdAt: o.createdAt, status: o.displayFinancialStatus ?? 'unknown' }))
  // Invoices that ship stay drafts until paid (invoiceToShip).
  const open = await shopifyGraphQL<{ draftOrders: { nodes: Array<{ name: string; email: string | null; createdAt: string; totalPriceSet: Money }> } }>(
    `query { draftOrders(first: 50, sortKey: UPDATED_AT, reverse: true, query: "tag:invoice AND status:invoice_sent") { nodes { name email createdAt totalPriceSet { shopMoney { amount } } } } }`,
  )
  const waiting = open.draftOrders.nodes.map((o) => ({ name: o.name, email: o.email, total: money(o.totalPriceSet), createdAt: o.createdAt, status: 'invoice sent, to ship once paid' }))
  return [...sold, ...waiting].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export type CancelCheck = {
  orderId: string
  orderName: string
  email: string | null
  total: number
  lines: Array<{ label: string; quantity: number; inShopify: boolean }>
  fulfillmentIds: string[]
  /** Why it cannot be cancelled here, in words for the person; null when it can. */
  blocked: string | null
}

/**
 * An unpaid live-sale invoice, read for cancelling. Brandon, 29 Sept 2026,
 * #2635: Mouse had no way to cancel one, and offered to log the belt as
 * RETURNED by hand, which would have counted it back twice once Shopify's
 * own restock synced. Paid invoices are refused: money going back is the
 * Support tab's refund, not this.
 */
export async function checkCancelLiveSale(orderNameIn: string): Promise<CancelCheck | null> {
  const name = `#${orderNameIn.replace(/^#/, '').trim()}`
  const d = await shopifyGraphQL<{ orders: { nodes: Array<{
    id: string; name: string; email: string | null; cancelledAt: string | null; displayFinancialStatus: string | null; tags: string[]
    totalPriceSet: Money; lineItems: { nodes: Array<{ title: string; variantTitle: string | null; quantity: number; variant: { id: string } | null }> }
    fulfillments: Array<{ id: string; status: string }>
  }> } }>(
    `query($q: String!) { orders(first: 5, query: $q) { nodes { id name email cancelledAt displayFinancialStatus tags totalPriceSet { shopMoney { amount } }
      lineItems(first: 50) { nodes { title variantTitle quantity variant { id } } } fulfillments { id status } } } }`,
    { q: `name:${name}` },
  )
  const o = d.orders.nodes.find((n) => n.name === name)
  if (!o) return null
  let blocked: string | null = null
  if (o.cancelledAt) blocked = `${o.name} is already cancelled.`
  else if (!o.tags.includes('live-sale') && !o.tags.includes('gift')) blocked = `${o.name} is not a live-sale invoice or a gift. Cancel it in Shopify, or from the Support tab if it is a customer's web order.`
  // A $0 order reads "paid" in Shopify with nothing to give back (#2664, a
  // $0 hair tie, 30 Sept 2026): cancelling it moves no money.
  else if (o.displayFinancialStatus !== 'PENDING' && money(o.totalPriceSet) > 0) blocked = `${o.name} is ${String(o.displayFinancialStatus ?? '').toLowerCase().replace(/_/g, ' ')}, not unpaid. Money has to go back, so do it in Shopify rather than here.`
  return {
    orderId: o.id, orderName: o.name, email: o.email, total: money(o.totalPriceSet),
    lines: o.lineItems.nodes.map((l) => ({ label: `${l.title}${l.variantTitle ? ` — ${l.variantTitle}` : ''}`, quantity: l.quantity, inShopify: !!l.variant })),
    fulfillmentIds: o.fulfillments.filter((f) => f.status === 'SUCCESS').map((f) => f.id),
    blocked,
  }
}

/**
 * Cancel it: undo "handed over" (Shopify only puts unfulfilled items back on
 * stock), then cancel with restock and no refund, since nothing was paid.
 * The customer is not emailed by Shopify; the unpaid invoice link simply
 * stops working.
 */
export async function cancelLiveSale(c: CancelCheck, note: string): Promise<{ ok: boolean; error?: string }> {
  if (c.blocked) return { ok: false, error: c.blocked }
  for (const id of c.fulfillmentIds) {
    const f = await shopifyGraphQL<{ fulfillmentCancel: { fulfillment: { status: string } | null; userErrors: Array<{ message: string }> } }>(
      `mutation($id: ID!) { fulfillmentCancel(id: $id) { fulfillment { id status } userErrors { field message } } }`,
      { id },
    )
    if (!f.fulfillmentCancel.fulfillment) return { ok: false, error: `Shopify would not undo "handed over": ${f.fulfillmentCancel.userErrors.map((e) => e.message).join('; ') || 'no reason given'}. Nothing was cancelled.` }
  }
  const r = await shopifyGraphQL<{ orderCancel: { job: { id: string } | null; orderCancelUserErrors: Array<{ message: string }> } }>(
    `mutation($orderId: ID!, $note: String) { orderCancel(orderId: $orderId, reason: CUSTOMER, refundMethod: { originalPaymentMethodsRefund: false }, restock: true, notifyCustomer: false, staffNote: $note) { job { id done } orderCancelUserErrors { field message code } } }`,
    { orderId: c.orderId, note: note.slice(0, 250) },
  )
  if (r.orderCancel.orderCancelUserErrors.length) {
    return { ok: false, error: `Shopify refused the cancel: ${r.orderCancel.orderCancelUserErrors.map((e) => e.message).join('; ')}.${c.fulfillmentIds.length ? ' "Handed over" was already undone, so the order now shows unfulfilled — check it in Shopify.' : ''}` }
  }
  // The cancel runs as a job; wait until the order says so.
  for (let i = 0; i < 8; i++) {
    const o = await shopifyGraphQL<{ order: { cancelledAt: string | null } | null }>(`query($id: ID!) { order(id: $id) { cancelledAt } }`, { id: c.orderId })
    if (o.order?.cancelledAt) return { ok: true }
    await new Promise((res) => setTimeout(res, 1000))
  }
  return { ok: false, error: 'Shopify accepted the cancel but had not cancelled the order after 8 seconds. Check it in Shopify.' }
}

export type GiftResult = { orderName: string | null; orderId: string | null; handedOver: boolean; problems: string[] }

/**
 * A gift, as a Shopify order. Brandon, 30 Sept 2026: "cleo meant to gift these
 * and was trying to get them into shopify shipping label queue ... can we tell
 * mouse we want to gift this or that and it will take care of inventory and
 * label?" She had been using $0 invoices: Shopify will not email one, a $0
 * order marked handed over never reaches the label queue, and the hair tie on
 * #2664 was a loose line, so Shopify's count never moved.
 *
 * This makes a real order at retail with a 100% "Gift" discount, so the
 * books show what went out and what it was worth. No tax, nothing owed, no
 * email to the recipient. Shipped: the address goes on it and it is left
 * unfulfilled, so it waits in Orders with "Create shipping label". Handed
 * over: marked fulfilled so it is never packed. Shopify takes the items off
 * stock itself; tagged "gift" so it stays out of sales history.
 */
export async function giftOrder(args: { email: string | null; name: { firstName: string; lastName?: string | null }; lines: SaleLine[]; note: string; shipTo?: ShipAddress }): Promise<GiftResult> {
  const out: GiftResult = { orderName: null, orderId: null, handedOver: false, problems: [] }
  const who = await giftCustomer(args.email, args.name, args.shipTo)
  if (who.problem) out.problems.push(who.problem)
  const opts: InvoiceOptions = {
    tags: ['gift', 'studio-mouse'], taxExempt: true, discount: GIFT_DISCOUNT, customerId: who.id,
    ...(args.shipTo ? { shipTo: args.shipTo, shippingCharge: 0, shippingTitle: 'Gift, no charge' } : {}),
  }
  const created = await shopifyGraphQL<DraftCreated>(
    `mutation($input: DraftOrderInput!) { draftOrderCreate(input: $input) { draftOrder { id } userErrors { message } } }`,
    { input: draftInput(args.email ?? '', args.lines, args.note, opts) },
  )
  const draftId = created.draftOrderCreate.draftOrder?.id
  if (!draftId) {
    out.problems.push(`Shopify would not create the gift order: ${created.draftOrderCreate.userErrors.map((e) => e.message).join('; ') || 'no reason given'}. Nothing was created and stock has not moved.`)
    return out
  }
  // Nothing is owed, so not "payment pending".
  const done = await shopifyGraphQL<{ draftOrderComplete: { draftOrder: { order: { id: string; name: string } | null } | null; userErrors: Array<{ message: string }> } }>(
    `mutation($id: ID!) { draftOrderComplete(id: $id, paymentPending: false) { draftOrder { order { id name } } userErrors { message } } }`,
    { id: draftId },
  )
  const order = done.draftOrderComplete.draftOrder?.order
  if (!order) {
    out.problems.push(`The gift was drafted but Shopify would not turn it into an order: ${done.draftOrderComplete.userErrors.map((e) => e.message).join('; ') || 'no reason given'}. Stock has not moved; the draft is under Orders → Drafts in Shopify.`)
    return out
  }
  out.orderId = order.id
  out.orderName = order.name
  if (args.shipTo) return out

  let foIds: string[] = []
  for (let i = 0; i < 5 && !foIds.length; i++) {
    const fo = await shopifyGraphQL<{ order: { fulfillmentOrders: { nodes: Array<{ id: string; status: string }> } } | null }>(
      `query($id: ID!) { order(id: $id) { fulfillmentOrders(first: 5) { nodes { id status } } } }`,
      { id: order.id },
    )
    foIds = (fo.order?.fulfillmentOrders.nodes ?? []).filter((n) => n.status === 'OPEN').map((n) => n.id)
    if (!foIds.length) await new Promise((r) => setTimeout(r, 800))
  }
  if (foIds.length) {
    const f = await shopifyGraphQL<{ fulfillmentCreate: { fulfillment: { id: string } | null; userErrors: Array<{ message: string }> } }>(
      `mutation($f: FulfillmentInput!) { fulfillmentCreate(fulfillment: $f) { fulfillment { id } userErrors { message } } }`,
      { f: { notifyCustomer: false, lineItemsByFulfillmentOrder: foIds.map((id) => ({ fulfillmentOrderId: id })) } },
    )
    out.handedOver = !!f.fulfillmentCreate.fulfillment
  }
  if (!out.handedOver) out.problems.push(`${order.name} was not marked handed over. Mark it fulfilled in Shopify, or it will show up to be packed and shipped.`)
  return out
}

/** Every gift carries the whole price as a discount, so its value shows. */
export const GIFT_DISCOUNT = { percent: 100, title: 'Gift' }

/**
 * A gift when we do not have the address: the draft itself is emailed, and
 * its checkout link asks the recipient for where to send it, with nothing to
 * pay. Brandon, 30 Sept 2026, for Carol Lee: "create a $0 invoice for a gift
 * ... that will email her so she can input address." It has to stay a draft:
 * #2664 was completed into a $0 order first, Shopify closed it, and a closed
 * order will not email.
 *
 * Nothing leaves stock until she checks out; then Shopify makes the order,
 * with her address, unfulfilled and tagged gift, and it waits for a label.
 */
export async function giftInvite(args: { email: string; firstName: string; lastName?: string | null; lines: SaleLine[]; note: string; message?: string | null }): Promise<{ draftName: string | null; sent: boolean; problems: string[] }> {
  const who = await giftCustomer(args.email, { firstName: args.firstName, lastName: args.lastName })
  const opts: InvoiceOptions = { tags: ['gift', 'studio-mouse'], taxExempt: true, discount: GIFT_DISCOUNT, shippingCharge: 0, shippingTitle: 'Gift, no charge', customerId: who.id }
  const created = await shopifyGraphQL<{ draftOrderCreate: { draftOrder: { id: string; name: string } | null; userErrors: Array<{ message: string }> } }>(
    `mutation($input: DraftOrderInput!) { draftOrderCreate(input: $input) { draftOrder { id name } userErrors { message } } }`,
    { input: draftInput(args.email, args.lines, args.note, opts) },
  )
  const d = created.draftOrderCreate.draftOrder
  if (!d) return { draftName: null, sent: false, problems: [`Shopify would not create the gift: ${created.draftOrderCreate.userErrors.map((e) => e.message).join('; ') || 'no reason given'}. Nothing was created or sent.`] }
  const base = {
    to: args.email,
    subject: 'A gift from Cleo Camp',
    customMessage: giftInviteText(args.firstName, args.message),
  }
  const send = (e: Record<string, unknown>) => shopifyGraphQL<{ draftOrderInvoiceSend: { draftOrder: { id: string } | null; userErrors: Array<{ message: string }> } }>(
    `mutation($id: ID!, $email: EmailInput) { draftOrderInvoiceSend(id: $id, email: $email) { draftOrder { id } userErrors { message } } }`,
    { id: d.id, email: e },
  )
  let r = await send({ ...base, from: INVOICE_FROM })
  if (!r.draftOrderInvoiceSend.draftOrder || r.draftOrderInvoiceSend.userErrors.length) r = await send(base)
  const sent = !!r.draftOrderInvoiceSend.draftOrder && !r.draftOrderInvoiceSend.userErrors.length
  return {
    draftName: d.name, sent,
    problems: sent ? [] : [`The gift ${d.name} was made but the email did not go (${r.draftOrderInvoiceSend.userErrors.map((e) => e.message).join('; ') || 'no reason given'}). Open ${d.name} under Orders → Drafts in Shopify and use "Send invoice".`],
  }
}

/** The words above the link in the gift email. A line from the person goes in first. Pure. */
export function giftInviteText(firstName: string, message?: string | null): string {
  const extra = message?.trim() ? `${message.trim()}\n\n` : ''
  return `Hi ${firstName}, ${extra}Cleo would like to send you a gift. Tap the link below and add the address you'd like it sent to. There is nothing to pay.\n\nKindly,\nCleo Studio`
}

/**
 * Who a gift is for, as a Shopify customer, so the order shows their name
 * (Brandon, 30 Sept 2026, on #2667: "Shouldn't the customer name be filled
 * out"). By email when we have one, the same customer every time; otherwise
 * made from the name and shipping address. If Shopify will not, the gift
 * still goes and the order carries the name on its address.
 */
export async function giftCustomer(email: string | null, name: { firstName: string; lastName?: string | null }, address?: ShipAddress): Promise<{ id: string | null; problem?: string }> {
  if (email) {
    const r = await storeCustomer(email, name, ['gift'])
    return r.id ? r : { id: null, problem: `No Shopify customer was attached (${r.problem ?? 'no reason given'}); the name is on the address.` }
  }
  try {
    const made = await shopifyGraphQL<{ customerCreate: { customer: { id: string } | null; userErrors: Array<{ message: string }> } }>(
      `mutation($input: CustomerInput!) { customerCreate(input: $input) { customer { id } userErrors { message } } }`,
      { input: { firstName: name.firstName, lastName: name.lastName ?? null, tags: ['gift'], ...(address ? { addresses: [{ ...address, company: address.company ?? null }] } : {}) } },
    )
    return made.customerCreate.customer
      ? { id: made.customerCreate.customer.id }
      : { id: null, problem: `No Shopify customer was attached (${made.customerCreate.userErrors.map((e) => e.message).join('; ')}); the name is on the address.` }
  } catch (e) {
    return { id: null, problem: `No Shopify customer was attached (${e instanceof Error ? e.message.slice(0, 120) : String(e)}); the name is on the address.` }
  }
}
