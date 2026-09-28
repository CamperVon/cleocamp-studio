import { Card, Page } from '@/app/ui/primitives'
import { freshScopes } from '@/lib/integrations/shopify'

export const dynamic = 'force-dynamic'

/**
 * What the Studio Mouse app is allowed to do in Shopify, asked fresh each
 * load. Adding permissions takes two steps (release a version in the Dev
 * Dashboard, then the store approves it) and on 27 Sept 2026 nobody could
 * tell whether the second step had happened. This page answers it.
 */
const NEEDS: Array<{ what: string; scopes: string[] }> = [
  { what: 'Read orders and products', scopes: ['read_orders', 'read_products'] },
  { what: 'Change stock counts', scopes: ['write_inventory'] },
  { what: 'Change an address, cancel and refund', scopes: ['write_orders'] },
  { what: 'Remove an unshipped item', scopes: ['write_order_edits'] },
  { what: 'Invoice a live sale', scopes: ['write_draft_orders', 'write_merchant_managed_fulfillment_orders'] },
  { what: 'Put a store\'s name on a wholesale invoice', scopes: ['write_customers'] },
]

export default async function ShopifyAccess() {
  const scopes = await freshScopes()
  // A write permission includes the matching read.
  const has = (s: string) => !!scopes && (scopes.includes(s) || scopes.includes(s.replace(/^read_/, 'write_')))
  return (
    <Page title="Shopify access" lede="What the Studio Mouse app may do in the store, checked with Shopify just now.">
      <Card>
        {scopes === null ? (
          <p className="px-4 py-3 text-sm text-urgent sm:px-5">Could not reach Shopify to check.</p>
        ) : (
          <ul className="divide-y divide-line">
            {NEEDS.map((n) => {
              const missing = n.scopes.filter((s) => !has(s))
              return (
                <li key={n.what} className="flex items-start justify-between gap-3 px-4 py-3 text-sm sm:px-5">
                  <span>{n.what}</span>
                  {missing.length
                    ? <span className="text-right text-urgent">Not allowed yet<span className="block text-xs">needs {missing.join(', ')}</span></span>
                    : <span className="text-accent">Allowed</span>}
                </li>
              )
            })}
          </ul>
        )}
      </Card>
      {scopes ? <p className="px-1 text-xs text-faint">Granted: {scopes.join(', ') || 'none'}</p> : null}
    </Page>
  )
}
