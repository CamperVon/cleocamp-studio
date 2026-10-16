'use server'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { AUTHORIZE_KEYS, authorizeParams, checkAuthorize, issueCode, urls } from '@/lib/mcp/oauth'
import { currentPersonId, isSignedIn } from '@/lib/session'
import { requestOrigin } from './origin'

/**
 * Allow or Deny on the connector's consent screen. Everything is checked
 * again here, from the form, not trusted from the page that showed it: the
 * session, the client, its registered return address, PKCE, the resource.
 * Server actions also refuse a post from another site (Next's origin check).
 */
async function settle(formData: FormData, allow: boolean) {
  const p = authorizeParams((k) => { const v = formData.get(k); return typeof v === 'string' && v ? v : null })
  const qs = new URLSearchParams(AUTHORIZE_KEYS.flatMap((k) => (p[k] ? [[k, p[k]!]] : [])))
  if (!(await isSignedIn())) redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${qs}`)}`)
  const origin = await requestOrigin()
  const check = await checkAuthorize(db, p, origin)
  if (!check.ok) redirect(`/oauth/authorize?${qs}`)
  const back = new URL(p.redirect_uri!)
  if (allow) back.searchParams.set('code', await issueCode(db, p, origin, await currentPersonId()))
  else back.searchParams.set('error', 'access_denied')
  if (p.state) back.searchParams.set('state', p.state)
  back.searchParams.set('iss', urls(origin).issuer)
  redirect(back.toString())
}

export async function allow(formData: FormData) { await settle(formData, true) }
export async function deny(formData: FormData) { await settle(formData, false) }
