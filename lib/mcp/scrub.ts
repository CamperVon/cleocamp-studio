/**
 * The last line before anything leaves through the Claude connector
 * (16 Oct 2026). Each tool already picks only the fields it needs and never
 * selects a vendor's email, address, contact or notes; this runs over every
 * string of every answer anyway, because free text (a note, a to-do, the
 * brief) can hold anything a person typed. Pure.
 *
 * Removed: email addresses, phone numbers, card numbers (13 to 19 digits that
 * pass the Luhn check cards carry), bank details (a number right after
 * account, routing, IBAN, SWIFT, wire or bank, and anything IBAN-shaped), and
 * anything shaped like an API key or token. A bare long number is left alone:
 * on 16 Oct 2026 a blanket rule took out two supplier invoice numbers and a
 * USPS tracking number, which are exactly what the team asks about. Vendor
 * bank details are never read at all; this is the backstop for free text.
 */

const KEY = /\b(?:sk-ant-[\w-]{8,}|sk_(?:live|test)_\w{8,}|rk_(?:live|test)_\w{8,}|shp(?:at|ss|ca|pa)_\w{8,}|re_[A-Za-z0-9_]{16,}|gh[pousr]_\w{16,}|github_pat_\w{16,}|xox[abprs]-[\w-]{8,}|AKIA[0-9A-Z]{16}|eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,})/g
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
// 13 to 19 digits, spaces or dashes allowed between them; removed if it passes Luhn.
const CARD = /\b\d(?:[ -]?\d){12,18}\b/g
// A number following a word that says it is bank details.
const BANK = /\b(account|acct|a\/c|routing|aba|iban|swift|bic|sort code|bank|wire|ach)\b([^0-9\n]{0,30}?)(\d[\d -]{3,30}\d)/gi
const IBAN = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,3})?\b/g

/** The Luhn check every payment card number passes. Pure. */
export function luhn(digits: string): boolean {
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i])
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9 }
    sum += d
  }
  return digits.length >= 13 && sum % 10 === 0
}
// US and international phone shapes: (213) 619-0002, 213-619-0002, +1 213 619 0002, +44 20 7946 0958.
const PHONE = /(?:\+\d{1,3}[ .-]?)?\(?\b\d{3}\)?[ .-]\d{3}[ .-]\d{4}\b|\+\d{1,3}(?:[ .-]?\d{2,4}){2,4}\b/g

export function scrubText(s: string): string {
  return s
    .replace(KEY, '[removed: key]')
    .replace(EMAIL, '[removed: email]')
    .replace(IBAN, '[removed: bank details]')
    .replace(BANK, (_, word: string, gap: string) => `${word}${gap}[removed: bank details]`)
    .replace(CARD, (m) => (luhn(m.replace(/\D/g, '')) ? '[removed: card]' : m))
    .replace(PHONE, '[removed: phone]')
}

/** Every string in a JSON-shaped value, scrubbed; keys and numbers left as they are. */
export function scrub<T>(v: T): T {
  if (typeof v === 'string') return scrubText(v) as T
  if (Array.isArray(v)) return v.map(scrub) as T
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrub(x)])) as T
  }
  return v
}
