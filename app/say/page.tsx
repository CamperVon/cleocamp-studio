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
export const metadata: Metadata = { title: 'Tell Mouse' }
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
