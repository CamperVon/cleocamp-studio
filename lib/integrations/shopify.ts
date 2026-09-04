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

// ─────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────

export type ShopifyVariant = {
  id: string
  title: string
  sku: string | null
  price: string
  inventoryQuantity: number | null
  image: { url: string } | null
  inventoryItem: { id: string }
  selectedOptions: Array<{ name: string; value: string }>
  product: { id: string; title: string; handle: string; status: string; featuredImage: { url: string } | null }
}

/** Every variant in the store, paged. */
export async function fetchAllVariants(): Promise<ShopifyVariant[]> {
  const out: ShopifyVariant[] = []
  let cursor: string | null = null
  do {
    const d: any = await shopifyGraphQL(
      `query($cursor: String) {
        productVariants(first: 200, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id title sku price inventoryQuantity
            image { url }
            inventoryItem { id }
            selectedOptions { name value }
            product { id title handle status featuredImage { url } }
          }
        }
      }`,
      { cursor },
    )
    out.push(...d.productVariants.nodes)
    cursor = d.productVariants.pageInfo.hasNextPage ? d.productVariants.pageInfo.endCursor : null
  } while (cursor)
  return out
}

export async function fetchLocations() {
  const d = await shopifyGraphQL<{
    locations: { nodes: Array<{ id: string; name: string; isActive: boolean }> }
  }>(`{ locations(first: 20) { nodes { id name isActive } } }`)
  return d.locations.nodes
}

export type SoldLine = { date: string; variantId: string; quantity: number }

/**
 * Sales history, flattened to one row per variant per day.
 *
 * Dates are bucketed in America/Los_Angeles, not UTC — a sale at 6pm Pacific
 * belongs to that day, not tomorrow. Getting this wrong shifts a whole day of
 * demand and quietly skews every forecast.
 */
export async function fetchSoldLines(sinceISO: string): Promise<SoldLine[]> {
  const out: SoldLine[] = []
  let cursor: string | null = null
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
  })

  do {
    const d: any = await withRetry(() =>
      shopifyGraphQL(
        `query($cursor: String, $q: String!) {
          orders(first: 40, after: $cursor, query: $q, sortKey: CREATED_AT) {
            pageInfo { hasNextPage endCursor }
            nodes {
              createdAt cancelledAt
              lineItems(first: 50) { nodes { quantity variant { id } } }
            }
          }
        }`,
        { cursor, q: `created_at:>=${sinceISO}` },
      ),
    )
    for (const o of d.orders.nodes) {
      if (o.cancelledAt) continue
      const date = fmt.format(new Date(o.createdAt))
      for (const li of o.lineItems.nodes) {
        if (!li.variant?.id) continue // deleted product, or a custom line
        out.push({ date, variantId: li.variant.id, quantity: li.quantity })
      }
    }
    cursor = d.orders.pageInfo.hasNextPage ? d.orders.pageInfo.endCursor : null
  } while (cursor)

  return out
}

/** Shopify throttles on a cost budget; back off rather than failing the sync. */
async function withRetry<T>(fn: () => Promise<T>, tries = 5): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn()
    } catch (e) {
      const msg = (e as Error).message
      if (i >= tries - 1 || !/throttl|exceeded/i.test(msg)) throw e
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)))
    }
  }
}

/**
 * Push a stock change to Shopify — the other half of "Shopify is master."
 * Delta-based (inventoryAdjustQuantities), never absolute
 * (inventorySetQuantities): Shopify's own docs say the set mutation is only
 * for a system that IS the source of truth, which this app deliberately is
 * not. idempotencyKey should be the InventoryEvent's own id, so a retried
 * request can never apply the same change twice.
 *
 * changeFromQuantity is required as of this API version (found by testing
 * against the real API, not the docs — a version bump between when this was
 * researched and when it was built made it mandatory). It buys real
 * protection along with the requirement: Shopify rejects the write if the
 * count there has moved since changeFromQuantity was read — a real sale
 * landing mid-write, say — rather than silently applying a delta against a
 * number that's no longer true.
 */
export async function adjustInventory(args: {
  inventoryItemId: string
  locationId: string
  delta: number
  changeFromQuantity: number
  idempotencyKey: string
  reason?: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const d: any = await withRetry(() =>
    shopifyGraphQL(
      `mutation adjust($input: InventoryAdjustQuantitiesInput!, $idempotencyKey: String!) {
        inventoryAdjustQuantities(input: $input) @idempotent(key: $idempotencyKey) {
          userErrors { field message }
        }
      }`,
      {
        idempotencyKey: args.idempotencyKey,
        input: {
          reason: args.reason ?? 'correction',
          name: 'available',
          changes: [{
            delta: args.delta,
            changeFromQuantity: args.changeFromQuantity,
            inventoryItemId: args.inventoryItemId,
            locationId: args.locationId,
          }],
        },
      },
    ),
  )
  const errors = d.inventoryAdjustQuantities?.userErrors ?? []
  if (errors.length) return { ok: false, error: errors.map((e: any) => e.message).join('; ') }
  return { ok: true }
}

/** Orders paid for but not yet shipped — the pile waiting on the packing table. */
export async function fetchToShipCount(): Promise<number> {
  const d = await shopifyGraphQL<{ ordersCount: { count: number } }>(
    `{ ordersCount(query: "fulfillment_status:unfulfilled AND status:open") { count } }`,
  )
  return d.ordersCount.count
}
