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
 * NO MANIFEST ON THIS PAGE, deliberately. That is not an omission.
 *
 * Two things go wrong when a web app manifest is linked here, and both were
 * reported within a minute of each other. iOS prefers the manifest's
 * short_name over `apple-mobile-web-app-title` when both are present, so Add
 * to Home Screen pre-filled "Studio" and the Say Cheese name never appeared
 * however clearly the instructions said it. And a manifest carries a fixed
 * start_url — "/" — which iOS uses INSTEAD of the address you added from, so
 * the installed icon would have opened the app root and thrown away the
 * personal token in the URL, leaving an app that could not tell who was
 * holding it.
 *
 * Without the manifest, iOS takes the name from the meta tag below and the
 * address from the page you are standing on, which is exactly what is wanted:
 * "Say Cheese", opening at this person's own link.
 */
export const metadata: Metadata = {
  title: 'Tell Mouse',
  manifest: null,
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
