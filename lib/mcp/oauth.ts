import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { PrismaClient } from '@/generated/prisma/client'

/**
 * OAuth 2.1 for the read-only Claude connector (16 Oct 2026), as the MCP
 * authorization spec and claude.ai custom connectors expect: protected
 * resource metadata (RFC 9728), authorization server metadata (RFC 8414),
 * dynamic client registration (RFC 7591), the authorization code grant with
 * PKCE S256 only, resource indicators (RFC 8707), and rotating refresh
 * tokens.
 *
 * Gated by the app's own login: /oauth/authorize shows a consent screen only
 * to someone signed in to this app (the shared password or a personal link),
 * and nothing is granted until they tap Allow.
 *
 * Tokens are 32 random bytes, handed out once and stored only as a SHA-256
 * hash (McpGrant.tokenHash), so a copy of the database holds nothing usable.
 * No new secret or environment variable is needed.
 */

export const SCOPE = 'mouse.read'
export const ACCESS_TTL_S = 60 * 60
export const REFRESH_TTL_S = 30 * 24 * 60 * 60
export const CODE_TTL_S = 5 * 60
export const MCP_PATH = '/api/mcp'

/**
 * Where an approval may be sent. Only Claude's own OAuth callbacks: an
 * approval can never be delivered to anyone else's server, whoever registered
 * the client. Exact match, nothing else.
 */
export const ALLOWED_REDIRECTS = new Set([
  'https://claude.ai/api/mcp/auth_callback',
  'https://claude.com/api/mcp/auth_callback',
])

/** Registered clients are cheap to make; this caps how many can pile up unused. */
export const MAX_CLIENTS = 200

type Db = Pick<PrismaClient, 'mcpClient' | 'mcpGrant' | '$transaction'>

export const newToken = () => randomBytes(32).toString('base64url')
export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex')
const sameHash = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

/** PKCE S256: base64url(SHA-256(verifier)) must equal the challenge. Pure. */
export function pkceMatches(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false
  const computed = createHash('sha256').update(verifier).digest('base64url')
  return sameHash(computed, challenge)
}

/** The connector's own URLs, from the origin the request came in on. Pure. */
export function urls(origin: string) {
  const o = origin.replace(/\/+$/, '')
  return {
    issuer: o,
    resource: `${o}${MCP_PATH}`,
    resourceMetadata: `${o}/.well-known/oauth-protected-resource`,
    authorize: `${o}/oauth/authorize`,
    token: `${o}/api/oauth/token`,
    register: `${o}/api/oauth/register`,
  }
}

const norm = (u: string) => u.replace(/\/+$/, '')
/** RFC 8707: a resource, when given, must be this connector's endpoint. Pure. */
export const resourceOk = (given: string | null | undefined, origin: string) => !given || norm(given) === norm(urls(origin).resource)

export function protectedResourceMetadata(origin: string) {
  const u = urls(origin)
  return {
    resource: u.resource,
    authorization_servers: [u.issuer],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ['header'],
    resource_name: 'Studio Mouse (read-only)',
  }
}

export function authorizationServerMetadata(origin: string) {
  const u = urls(origin)
  return {
    issuer: u.issuer,
    authorization_endpoint: u.authorize,
    token_endpoint: u.token,
    registration_endpoint: u.register,
    scopes_supported: [SCOPE],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    authorization_response_iss_parameter_supported: true,
  }
}

export class OAuthError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message) }
  body() { return { error: this.code, error_description: this.message } }
}

// ---- registration (RFC 7591) ----

export async function registerClient(db: Db, body: unknown) {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const redirects = Array.isArray(b.redirect_uris) ? b.redirect_uris.filter((u): u is string => typeof u === 'string') : []
  if (!redirects.length) throw new OAuthError('invalid_redirect_uri', 'redirect_uris is required')
  const bad = redirects.filter((u) => !ALLOWED_REDIRECTS.has(u))
  if (bad.length) throw new OAuthError('invalid_redirect_uri', `only Claude's own callback is accepted: ${[...ALLOWED_REDIRECTS].join(', ')}`)
  const method = typeof b.token_endpoint_auth_method === 'string' ? b.token_endpoint_auth_method : 'none'
  if (!['none', 'client_secret_post', 'client_secret_basic'].includes(method)) throw new OAuthError('invalid_client_metadata', `token_endpoint_auth_method ${method} is not supported`)
  const grants = Array.isArray(b.grant_types) ? b.grant_types : ['authorization_code', 'refresh_token']
  if (grants.some((g) => g !== 'authorization_code' && g !== 'refresh_token')) throw new OAuthError('invalid_client_metadata', 'only authorization_code and refresh_token are supported')
  const name = typeof b.client_name === 'string' ? b.client_name.slice(0, 120) : null

  // Clear out registrations nobody ever approved, then cap what is left.
  await db.mcpClient.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 24 * 3600e3) }, grants: { none: {} } } })
  if ((await db.mcpClient.count()) >= MAX_CLIENTS) throw new OAuthError('temporarily_unavailable', 'too many registered clients', 503)

  const id = `mcp_${newToken()}`
  const secret = method === 'none' ? null : newToken()
  await db.mcpClient.create({ data: { id, name, redirectUris: redirects, tokenEndpointAuthMethod: method, secretHash: secret ? hashToken(secret) : null } })
  return {
    client_id: id,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
    client_name: name ?? undefined,
    redirect_uris: redirects,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: method,
    scope: SCOPE,
  }
}

// ---- authorization ----

export type AuthorizeParams = {
  response_type: string | null
  client_id: string | null
  redirect_uri: string | null
  code_challenge: string | null
  code_challenge_method: string | null
  state: string | null
  scope: string | null
  resource: string | null
}

export const AUTHORIZE_KEYS = ['response_type', 'client_id', 'redirect_uri', 'code_challenge', 'code_challenge_method', 'state', 'scope', 'resource'] as const

export function authorizeParams(get: (k: string) => string | null | undefined): AuthorizeParams {
  return Object.fromEntries(AUTHORIZE_KEYS.map((k) => [k, get(k) ?? null])) as AuthorizeParams
}

/**
 * Everything checked before the consent screen is shown, and again when Allow
 * is tapped. An unknown client or a redirect it did not register is shown as
 * an error here and never redirected to.
 */
export async function checkAuthorize(db: Db, p: AuthorizeParams, origin: string): Promise<{ ok: true; clientName: string | null } | { ok: false; error: string }> {
  if (!p.client_id) return { ok: false, error: 'No client_id.' }
  const client = await db.mcpClient.findUnique({ where: { id: p.client_id } })
  if (!client) return { ok: false, error: 'This app is not registered here. Remove the connector in Claude and add it again.' }
  if (!p.redirect_uri || !client.redirectUris.includes(p.redirect_uri) || !ALLOWED_REDIRECTS.has(p.redirect_uri)) return { ok: false, error: 'The return address does not match what this app registered.' }
  if (p.response_type !== 'code') return { ok: false, error: 'Only response_type=code is supported.' }
  if (!p.code_challenge || p.code_challenge_method !== 'S256') return { ok: false, error: 'PKCE with S256 is required.' }
  if (p.scope && !p.scope.split(' ').every((s) => s === SCOPE)) return { ok: false, error: `Only the ${SCOPE} scope exists.` }
  if (!resourceOk(p.resource, origin)) return { ok: false, error: 'This approval was asked for a different server.' }
  return { ok: true, clientName: client.name }
}

/** Approved: a single-use code for this client, redirect and PKCE challenge. */
export async function issueCode(db: Db, p: AuthorizeParams, origin: string, personId: string | null): Promise<string> {
  const code = newToken()
  await db.mcpGrant.create({
    data: {
      kind: 'code', tokenHash: hashToken(code), clientId: p.client_id!, familyId: newToken(), personId,
      scope: SCOPE, resource: urls(origin).resource, codeChallenge: p.code_challenge, redirectUri: p.redirect_uri,
      expiresAt: new Date(Date.now() + CODE_TTL_S * 1000),
    },
  })
  return code
}

// ---- token endpoint ----

/** Who the caller is: client_id, and its secret when it registered with one (post or basic). */
function clientCredentials(form: URLSearchParams, authorization: string | null) {
  if (authorization?.toLowerCase().startsWith('basic ')) {
    const raw = Buffer.from(authorization.slice(6).trim(), 'base64').toString('utf8')
    const i = raw.indexOf(':')
    if (i > 0) return { id: decodeURIComponent(raw.slice(0, i)), secret: decodeURIComponent(raw.slice(i + 1)) }
  }
  return { id: form.get('client_id'), secret: form.get('client_secret') }
}

async function authenticateClient(db: Db, form: URLSearchParams, authorization: string | null) {
  const c = clientCredentials(form, authorization)
  if (!c.id) throw new OAuthError('invalid_client', 'client_id is required', 401)
  const client = await db.mcpClient.findUnique({ where: { id: c.id } })
  if (!client) throw new OAuthError('invalid_client', 'unknown client', 401)
  if (client.secretHash && (!c.secret || !sameHash(hashToken(c.secret), client.secretHash))) throw new OAuthError('invalid_client', 'client authentication failed', 401)
  return client
}

async function issueTokens(db: Db, g: { clientId: string; familyId: string; personId: string | null; resource: string }) {
  const access = newToken()
  const refresh = newToken()
  const now = Date.now()
  await db.mcpGrant.createMany({
    data: [
      { kind: 'access', tokenHash: hashToken(access), clientId: g.clientId, familyId: g.familyId, personId: g.personId, scope: SCOPE, resource: g.resource, expiresAt: new Date(now + ACCESS_TTL_S * 1000) },
      { kind: 'refresh', tokenHash: hashToken(refresh), clientId: g.clientId, familyId: g.familyId, personId: g.personId, scope: SCOPE, resource: g.resource, expiresAt: new Date(now + REFRESH_TTL_S * 1000) },
    ],
  })
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: SCOPE }
}

const revokeFamily = (db: Db, familyId: string) => db.mcpGrant.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date() } })

/**
 * Spend a code or a refresh token exactly once. The update only matches an
 * unspent, unrevoked, unexpired row, so two requests racing with the same
 * token cannot both win. A second use revokes everything issued from that
 * approval (RFC 9700: a replayed code or refresh token means it leaked).
 */
async function spend(db: Db, kind: 'code' | 'refresh', token: string) {
  const g = await db.mcpGrant.findUnique({ where: { tokenHash: hashToken(token) } })
  if (!g || g.kind !== kind) throw new OAuthError('invalid_grant', `unknown ${kind === 'code' ? 'authorization code' : 'refresh token'}`)
  if (g.usedAt || g.revokedAt) {
    await revokeFamily(db, g.familyId)
    throw new OAuthError('invalid_grant', `${kind === 'code' ? 'authorization code' : 'refresh token'} already used`)
  }
  if (g.expiresAt.getTime() <= Date.now()) throw new OAuthError('invalid_grant', `${kind === 'code' ? 'authorization code' : 'refresh token'} expired`)
  const won = await db.mcpGrant.updateMany({ where: { id: g.id, usedAt: null, revokedAt: null }, data: { usedAt: new Date() } })
  if (won.count !== 1) {
    await revokeFamily(db, g.familyId)
    throw new OAuthError('invalid_grant', 'already used')
  }
  return g
}

export async function tokenRequest(db: Db, form: URLSearchParams, authorization: string | null, origin: string) {
  const client = await authenticateClient(db, form, authorization)
  const grantType = form.get('grant_type')
  if (!resourceOk(form.get('resource'), origin)) throw new OAuthError('invalid_target', 'resource is not this server')

  if (grantType === 'authorization_code') {
    const code = form.get('code'), verifier = form.get('code_verifier'), redirect = form.get('redirect_uri')
    if (!code || !verifier) throw new OAuthError('invalid_request', 'code and code_verifier are required')
    const g = await spend(db, 'code', code)
    if (g.clientId !== client.id) { await revokeFamily(db, g.familyId); throw new OAuthError('invalid_grant', 'code was issued to another client') }
    if (redirect !== g.redirectUri) throw new OAuthError('invalid_grant', 'redirect_uri does not match')
    if (!g.codeChallenge || !pkceMatches(verifier, g.codeChallenge)) { await revokeFamily(db, g.familyId); throw new OAuthError('invalid_grant', 'code_verifier does not match') }
    return issueTokens(db, g)
  }

  if (grantType === 'refresh_token') {
    const token = form.get('refresh_token')
    if (!token) throw new OAuthError('invalid_request', 'refresh_token is required')
    const g = await spend(db, 'refresh', token)
    if (g.clientId !== client.id) { await revokeFamily(db, g.familyId); throw new OAuthError('invalid_grant', 'refresh token was issued to another client') }
    return issueTokens(db, g)
  }

  throw new OAuthError('unsupported_grant_type', 'use authorization_code or refresh_token')
}

// ---- the resource server ----

export type Caller = { clientId: string; personId: string | null; familyId: string; expiresAt: Date }

/** A bearer token that is a live access token for this endpoint, or null. */
export async function verifyAccess(db: Db, authorization: string | null, origin: string): Promise<Caller | null> {
  const m = authorization?.match(/^Bearer\s+([A-Za-z0-9_-]{20,200})$/i)
  if (!m) return null
  const g = await db.mcpGrant.findUnique({ where: { tokenHash: hashToken(m[1]) } })
  if (!g || g.kind !== 'access' || g.revokedAt || g.expiresAt.getTime() <= Date.now()) return null
  if (norm(g.resource) !== norm(urls(origin).resource)) return null
  return { clientId: g.clientId, personId: g.personId, familyId: g.familyId, expiresAt: g.expiresAt }
}

/** The 401 an MCP client reads to find where to sign in (RFC 9728 §5.1). */
export function unauthorized(origin: string, error?: 'invalid_token') {
  return new Response(JSON.stringify({ error: error ?? 'unauthorized', error_description: 'Sign in through the connector to use Studio Mouse.' }), {
    status: 401,
    headers: {
      'content-type': 'application/json',
      'www-authenticate': `Bearer realm="studio-mouse", resource_metadata="${urls(origin).resourceMetadata}"${error ? `, error="${error}"` : ''}`,
    },
  })
}

/** Disconnect an app: every token from every approval it holds stops working at once. */
export async function revokeClient(db: Db, clientId: string) {
  await db.mcpGrant.updateMany({ where: { clientId, revokedAt: null }, data: { revokedAt: new Date() } })
}
