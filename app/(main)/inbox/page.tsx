import { db } from '@/lib/db'
import { Page, Card, Empty, Chip } from '@/app/ui/primitives'

export const dynamic = 'force-dynamic'

const fmt = (d: Date) =>
  d.toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })

export default async function Inbox() {
  const mail = await db.inboundEmail.findMany({
    orderBy: { receivedAt: 'desc' },
    take: 100,
  })
  const unread = mail.filter((m) => !m.processedAt)

  return (
    <Page
      title="Inbox"
      lede="Mail copied to Studio Mouse. It reads these and raises questions — it never acts on them directly."
    >
      {!process.env.RESEND_WEBHOOK_SECRET ? (
        <div className="rounded-xl border border-warn bg-warn-soft px-4 py-3 text-sm text-warn sm:px-5">
          <p className="font-medium">Not receiving yet.</p>
          <p className="mt-1">
            RESEND_WEBHOOK_SECRET is not set, so the inbound route turns Resend away and
            nothing is stored. Add a webhook in Resend pointing at
            {' '}<code className="font-mono text-xs">/api/inbound/email</code>{' '}
            for the <code className="font-mono text-xs">email.received</code> event, then put
            its signing secret in the environment.
          </p>
        </div>
      ) : null}

      <Card title={`Received (${mail.length})`}>
        {mail.length === 0 ? (
          <Empty>
            Nothing yet. CC any of the addresses at send.cleocamp.com and it will land here.
          </Empty>
        ) : (
          <ul className="divide-y divide-line">
            {mail.map((m) => (
              <li key={m.id} className="px-4 py-3.5 sm:px-5">
                <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                  {!m.processedAt ? <Chip tone="accent">NEW</Chip> : null}
                  <p className="text-sm font-medium">{m.subject ?? '(no subject)'}</p>
                  <span className="text-xs text-faint">{fmt(m.receivedAt)}</span>
                </div>
                <p className="mt-0.5 text-xs text-muted">
                  {m.fromAddress} &rarr; {m.toAddress}
                </p>
                {m.text ? (
                  <p className="mt-1.5 line-clamp-3 text-sm text-muted">{m.text.trim()}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {unread.length ? (
        <p className="text-center text-xs text-faint">
          {unread.length} not yet read by Studio Mouse. It will work through these once
          the chat is live, raising anything that needs your confirmation.
        </p>
      ) : null}
    </Page>
  )
}
