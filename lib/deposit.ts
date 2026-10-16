/**
 * A wholesale invoice for part now and the rest later (Bucatini, D62, 16 Oct
 * 2026: half now, half on delivery). Mouse could only change line prices, so
 * the choices were halving every price (the $7,060 order then appears
 * nowhere, and the store sees half-price bags) or Brandon editing Shopify by
 * hand, which the next revision from the app wiped.
 *
 * So a deposit is an order-level discount Shopify applies to its own prices,
 * titled with what it is: "50% deposit. Balance of $3,530 due on delivery."
 * The invoice then shows the full subtotal, that line, and what is due now.
 * The balance figure is Shopify's discount amount, never worked out here
 * (CLAUDE.md §6: money is worked out by Shopify). Pure.
 */

const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })

/** Why a requested deposit cannot be used as given, or null. */
export function depositProblem(percent: unknown, balanceDue: unknown): string | null {
  if (typeof percent !== 'number' || !Number.isInteger(percent) || percent < 1 || percent > 99) return 'deposit is the percent due now, a whole number from 1 to 99 (50 for half).'
  const due = typeof balanceDue === 'string' ? balanceDue.trim() : ''
  if (!due) return 'Say when the balance is due (balanceDue), in the words the person used: "on delivery", "by 1 Nov". Ask if they have not said.'
  if (/[$€£]|\d+\.\d\d/.test(due)) return 'balanceDue is when, not how much: Shopify works out the amount.'
  return null
}

/** The discount that leaves only the deposit to pay now. */
export const depositDiscountPercent = (depositPercent: number) => 100 - depositPercent

/** The line on the invoice, once Shopify has said what the balance is. */
export function depositTitle(depositPercent: number, balance: number | null, balanceDue: string): string {
  const due = balanceDue.trim().replace(/[.\s]+$/, '')
  return balance == null
    ? `${depositPercent}% deposit. Balance due ${due}.`
    : `${depositPercent}% deposit. Balance of $${money(balance)} due ${due}.`
}

/** A deposit already on a draft, read back from its discount title, so a revision keeps it. */
export function parseDepositTitle(title: string | null | undefined): { percent: number; balanceDue: string } | null {
  const m = (title ?? '').match(/^(\d{1,2})% deposit\. Balance (?:of \$[\d,.]+ )?due (.+)\.$/)
  return m ? { percent: Number(m[1]), balanceDue: m[2] } : null
}
