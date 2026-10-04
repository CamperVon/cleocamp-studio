import { Page } from '@/app/ui/primitives'
import { WaitingNotice } from '@/app/ui/waiting-notice'

export const dynamic = 'force-dynamic'
// Each tap sends about twenty emails, spaced for Resend's rate limit.
export const maxDuration = 120

export default function Waiting() {
  return (
    <Page
      title="Message everyone waiting"
      lede="One email to each customer whose order is still waiting on a product, about their own order. Shopify is only read: no order is changed."
    >
      <WaitingNotice />
    </Page>
  )
}
