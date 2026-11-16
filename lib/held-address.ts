/**
 * Whether an address is held on one of our records, for send_email's guard
 * against addresses that appear nowhere (a wrong or planted one). Pure.
 *
 * Contacts count (16 Nov 2026): Mia Nikcevic was saved to Cleo Crew with her
 * address and the send was still refused, because the guard read vendors,
 * people, stylists, customers and stores but never the Contacts lists.
 * Whole addresses only, so x@gmail.com is not passed by max@gmail.com.
 */
export type HeldRecords = {
  /** Free-text fields that may hold several addresses: a vendor's contact line, email, cc list. */
  freeText: Array<string | null | undefined>
  /** Fields that hold one address each: people, stylists, customers, stores, contacts. */
  single: Array<string | null | undefined>
}

export function isHeldAddress(to: string, r: HeldRecords): boolean {
  const t = to.trim().toLowerCase()
  if (!t) return false
  if (/@(send\.)?cleocamp\.com$/.test(t)) return true
  if (r.single.some((e) => (e ?? '').trim().toLowerCase() === t)) return true
  return r.freeText.some((f) => (f ?? '').toLowerCase().split(/[\s,;<>()]+/).includes(t))
}
