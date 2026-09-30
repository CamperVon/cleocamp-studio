import path from 'node:path'
import { readFileSync } from 'node:fs'

/**
 * Cleo's wordmark for documents: the line sheet, the draft invoice PDF and
 * the purchase order. Brandon, 30 Sept 2026: "Can you pull her logo from her
 * brand deck? We would like to be using on documents."
 *
 * The deck itself (49MB) was out of reach, so this is the header logo from
 * cleocamp.com (cleo_logo_for_web, 1500x294). On the site it is silver on a
 * photo; on white paper that all but disappears, so documents print the same
 * letterforms in ink (cleo-wordmark-ink.png, made from the silver one by
 * keeping its alpha and setting the colour). The silver original sits beside
 * it. Swap either file for a better export from the deck without touching code.
 *
 * Read off disk for the reason the fonts are (top of lib/po-pdf.tsx); see the
 * assets/brand entries in next.config.ts. 900x102, so 8.8:1.
 */
export const WORDMARK_RATIO = 900 / 102

let cached: Buffer | null = null
export function wordmark(): { data: Buffer; format: 'png' } {
  cached ??= readFileSync(path.join(process.cwd(), 'assets', 'brand', 'cleo-wordmark-ink.png'))
  return { data: cached, format: 'png' }
}
