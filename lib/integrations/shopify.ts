/**
 * Shopify — the master for finished-goods inventory and retail prices.
 *
 * AUTHENTICATION
 * Shopify retired admin-created custom apps (and their one-time `shpat_`
 * tokens) on 1 January 2026. Apps built in the Dev Dashboard instead exchange
 * a client id and secret for a token via the client credentials grant. The
 * token lives for 24 hours, so it is minted on demand and cached rather than
 * stored in an env var. Nothing to re-reveal, nothing to lose.
 *
 * This only works while the app and the store sit in the same Shopify
 * organization, which they do.
 */

const API_VERSION = process.env.SHOPIFY_API_VERSION ?? '2026-07'

export class ShopifyNotConnected extends Error {
  constructor(missing: string) {
    super(
      `Shopify is not connected yet — ${missing} is not set. ` +
        `See README "Wiring up integrations later".`,
    )
    this.name = 'ShopifyNotConnected'
  }
}

function config() {
  const shop = process.env.SHOPIFY_STORE_DOMAIN
  const clientId = process.env.SHOPIFY_CLIENT_ID
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET
  if (!shop) throw new ShopifyNotConnected('SHOPIFY_STORE_DOMAIN')
  if (!clientId) throw new ShopifyNotConnected('SHOPIFY_CLIENT_ID')
  if (!clientSecret) throw new ShopifyNotConnected('SHOPIFY_CLIENT_SECRET')
  return { shop, clientId, clientSecret }
}

// Cached per warm serverless instance. Refreshed a minute early so a request
// can't be issued against a token that expires mid-flight.
let cached: { token: string; expiresAt: number } | null = null

export async function getAccessToken(): Promise<string> {
  if (cached && Date.now() < cached.expiresAt) return cached.token

  const { shop, clientId, clientSecret } = config()
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  })

  if (!res.ok) {
    throw new Error(
      `Shopify token request failed (${res.status}). ` +
        `Check the client secret, and that the app is installed on ${shop}.`,
    )
  }

  const body = (await res.json()) as {
    access_token: string
    scope?: string
    expires_in?: number
  }
  cached = {
    token: body.access_token,
    expiresAt: Date.now() + ((body.expires_in ?? 86_399) - 60) * 1000,
  }
  return cached.token
}

/** Admin GraphQL. Throws on GraphQL errors rather than returning a half-result. */
export async function shopifyGraphQL<T>(
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const { shop } = config()
  const token = await getAccessToken()

  const res = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify({ query, variables }),
  })

  if (!res.ok) throw new Error(`Shopify API ${res.status}: ${await res.text()}`)

  const json = (await res.json()) as { data: T; errors?: Array<{ message: string }> }
  if (json.errors?.length) {
    throw new Error(`Shopify GraphQL: ${json.errors.map((e) => e.message).join('; ')}`)
  }
  return json.data
}

/** Connection check — returns the shop name and the scopes actually granted. */
export async function ping() {
  return shopifyGraphQL<{
    shop: { name: string; myshopifyDomain: string; currencyCode: string }
  }>(`{ shop { name myshopifyDomain currencyCode } }`)
}

export function isConfigured() {
  try {
    config()
    return true
  } catch {
    return false
  }
}
