import { redirect } from 'next/navigation'

/**
 * Say Cheese, the dictate-only mini app, is retired (30 Sept 2026): Jane and
 * Cleo would rather have the full app on their phones. An icon still on
 * someone's home screen opens here with their key, and goes on to the full
 * app signed in as them (proxy.ts, /enter). /api/say, the Siri door, still
 * works.
 */
export default async function Say({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const k = (await searchParams).k
  redirect(typeof k === 'string' && k ? `/?k=${encodeURIComponent(k)}` : '/')
}
