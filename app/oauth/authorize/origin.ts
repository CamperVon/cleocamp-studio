import 'server-only'
import { headers } from 'next/headers'

/** The origin this page was reached on, so the code's resource matches the endpoint Claude will call. */
export async function requestOrigin(): Promise<string> {
  const h = await headers()
  const host = h.get('host') ?? 'localhost:3000'
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https')
  return `${proto}://${host}`
}
