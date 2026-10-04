import { Page, Card } from '@/app/ui/primitives'
import { WaitingNotice } from '@/app/ui/waiting-notice'

export const dynamic = 'force-dynamic'
// Each tap sends about twenty emails, spaced for Resend's rate limit.
export const maxDuration = 120

/**
 * Special: one-off emails and the like, on a tab of their own so nobody
 * mistakes them for everyday Support (Brandon, 4 Oct 2026). The first is
 * "Message everyone waiting" (lib/waiting-notice.ts).
 */
export default function Special() {
  return (
    <Page title="Special" lede="One-off emails and other special sends, kept apart from everyday Support.">
      <Card title={<span className="text-accent">Message everyone waiting</span>}>
        <div className="p-4 sm:p-5">
          <p className="mb-4 text-sm text-muted">
            One email to each customer whose order is still waiting on a product, about their own order.
            Shopify is only read: no order is changed.
          </p>
          <WaitingNotice />
        </div>
      </Card>
    </Page>
  )
}
