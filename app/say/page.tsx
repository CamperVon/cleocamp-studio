import type { Metadata, Viewport } from 'next'
import { SayClient } from './say-client'

/**
 * Deliberately outside the (main) layout: no nav, no header, nothing to tap by
 * mistake. Someone opening this is holding a phone in one hand with a fact
 * they are about to forget.
 *
 * It does NOT sit behind the app's shared password. The personal link is the
 * authentication, and asking someone to type a password in a car is the exact
 * friction this exists to remove. The token is checked on every send.
 */
/**
 * `appleWebApp.title` is what iOS pre-fills in the Add to Home Screen box, so
 * the name arrives already typed rather than depending on somebody reading an
 * instruction. Brandon, 21 Sept 2026, wanted it called Say Cheese — a sibling
 * to the Daily Cheese, and a better thing to see on a home screen at 7am than
 * "Tell Mouse". The browser tab keeps the plainer title.
 */
export const metadata: Metadata = {
  title: 'Tell Mouse',
  appleWebApp: { title: 'Say Cheese', capable: true },
}
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Keep the keyboard from zooming the page on iOS, which shoves the send
  // button off screen mid-sentence.
  maximumScale: 1,
}

export default function SayPage() {
  return <SayClient />
}
