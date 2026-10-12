/**
 * Put an email on a Shopify order after it was made (12 Oct 2026). Cleo
 * asked Mouse to add Ella Snyder's email to gift order #2794, made without
 * one; Mouse had no tool, so Ella would have had no shipping notification.
 *
 * Brandon: allowed from chat and from email "as long as its from us": a
 * verified team email (lib/mouse/team-mail.ts) may use it, untrusted mail
 * never can (it is not among the proposal tools).
 *
 * The order's email is set or replaced: it is where that order's updates go.
 * The customer record is only ever filled when it has no email. Replacing an
 * existing customer's email moves their account and every future order's
 * mail to someone else, so that stays a person's job in Shopify; the tool
 * says so rather than doing it.
 */
import { shopifyGraphQL } from '@/lib/integrations/shopify'

const EMAIL_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[a-z]{2,}$/i

/** Why an address cannot be used, or null. Pure. */
export function emailProblem(email: string): string | null {
  const e = email.trim()
  if (!e) return 'No email given.'
  if (!EMAIL_RE.test(e)) return `"${e}" is not an email address.`
  return null
}

/** What to change, given what the order and its customer have now. Pure. */
export function planEmailChange(now: { orderEmail: string | null; customerId: string | null; customerEmail: string | null }, email: string) {
  const same = (a: string | null) => !!a && a.trim().toLowerCase() === email.trim().toLowerCase()
  const setOrder = !same(now.orderEmail)
  const setCustomer = !!now.customerId && !now.customerEmail
  const customerKeeps = now.customerId && now.customerEmail && !same(now.customerEmail) ? now.customerEmail : null
  return { setOrder, setCustomer, customerKeeps }
}

type Found = { id: string; name: string; email: string | null; customer: { id: string; email: string | null; displayName: string } | null }

/** Set the email on Shopify order `orderNumber` (2794 or "#2794"), and on its customer if blank. */
export async function setOrderEmail(orderNumber: string, email: string) {
  const problem = emailProblem(email)
  if (problem) return { ok: false as const, error: problem }
  const e = email.trim()
  const n = String(orderNumber).replace(/^#/, '').trim()
  if (!/^\d+$/.test(n)) return { ok: false as const, error: `"${orderNumber}" is not an order number.` }
  const d = await shopifyGraphQL<{ orders: { nodes: Found[] } }>(
    `query($q: String!) { orders(first: 2, query: $q) { nodes { id name email customer { id email displayName } } } }`,
    { q: `name:#${n}` },
  )
  const order = d.orders.nodes.find((o) => o.name === `#${n}`)
  if (!order) return { ok: false as const, error: `No Shopify order #${n}.` }
  const plan = planEmailChange({ orderEmail: order.email, customerId: order.customer?.id ?? null, customerEmail: order.customer?.email ?? null }, e)
  const done: string[] = []
  const notDone: string[] = []
  if (plan.setOrder) {
    const r = await shopifyGraphQL<{ orderUpdate: { userErrors: Array<{ message: string }> } }>(
      `mutation($input: OrderInput!) { orderUpdate(input: $input) { order { id } userErrors { message } } }`,
      { input: { id: order.id, email: e } },
    )
    if (r.orderUpdate.userErrors.length) return { ok: false as const, error: `Shopify refused the order email: ${r.orderUpdate.userErrors.map((x) => x.message).join('; ')}` }
    done.push(`order ${order.name}: ${order.email ?? 'no email'} → ${e}`)
  }
  if (plan.setCustomer && order.customer) {
    const r = await shopifyGraphQL<{ customerUpdate: { userErrors: Array<{ message: string }> } }>(
      `mutation($input: CustomerInput!) { customerUpdate(input: $input) { customer { id } userErrors { message } } }`,
      { input: { id: order.customer.id, email: e } },
    )
    // Usually "Email has already been taken": another customer record has it.
    if (r.customerUpdate.userErrors.length) notDone.push(`${order.customer.displayName}'s customer record: Shopify said ${r.customerUpdate.userErrors.map((x) => x.message).join('; ')}`)
    else done.push(`${order.customer.displayName}'s customer record: no email → ${e}`)
  }
  if (plan.customerKeeps) notDone.push(`${order.customer!.displayName}'s customer record keeps ${plan.customerKeeps}: replacing a customer's email is done by a person in Shopify`)
  return { ok: true as const, order: order.name, changed: done, notChanged: notDone, ...(done.length ? {} : { skipped: true, note: 'Nothing needed changing.' }) }
}
