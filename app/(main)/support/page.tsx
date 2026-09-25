import { db } from '@/lib/db'
import { Card, Empty, Page } from '@/app/ui/primitives'
import { SupportCase, type CaseView } from '@/app/ui/support-case'
import { CATEGORY_LABEL, type Category } from '@/lib/support/core'

export const dynamic = 'force-dynamic'

// Outside the component: a server page reading the clock is fine, but the
// lint rule for components cannot tell it apart from a client re-render.
function age(d: Date): string {
  const mins = Math.round((Date.now() - d.getTime()) / 60000)
  if (mins < 60) return `${Math.max(mins, 1)}m`
  const hrs = Math.round(mins / 60)
  if (hrs < 48) return `${hrs}h`
  return `${Math.round(hrs / 24)}d`
}

async function loadCases() {
  return db.supportCase.findMany({
    where: {
      OR: [
        { status: { not: 'RESOLVED' } },
        { resolvedAt: { gte: new Date(Date.now() - 14 * 864e5) }, category: { not: 'SPAM' } },
      ],
    },
    orderBy: { lastMessageAt: 'desc' },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  })
}

/**
 * Customer email to support@cleocamp.com, sorted by Mouse. Phase 1 (23 Sept
 * 2026) sorted and alerted; phase 2 (24 Sept) drafts a reply that a person
 * edits and sends with a tap.
 */
export default async function Support() {
  const cases = await loadCases()

  const view = (c: (typeof cases)[number]): CaseView => ({
    id: c.id,
    who: c.customerName ?? c.customerEmail,
    customerEmail: c.customerEmail,
    category: CATEGORY_LABEL[c.category as Category] ?? c.category,
    urgency: c.urgency,
    status: c.status,
    summary: c.summary,
    subject: c.subject,
    orderName: c.shopifyOrderName,
    order: (c.orderSnapshot as CaseView['order']) ?? null,
    age: age(c.lastMessageAt),
    messages: c.messages.map((m) => ({ id: m.id, direction: m.direction, fromAddress: m.fromAddress, body: m.body, at: m.createdAt.toISOString(), emailedTo: m.emailedTo })),
    draft: c.draftedAt
      ? { reply: c.draftReply, needs: c.draftNeeds, address: (c.draftAddress as NonNullable<CaseView['draft']>['address']) ?? null, at: c.draftedAt.toISOString() }
      : null,
  })

  const open = cases.filter((c) => c.status === 'OPEN')
  const groups: Array<{ title: string; items: typeof cases; empty?: string }> = [
    // Pressing is only what also sends the alert email (lib/support/core.ts
    // finalUrgency). Everything else open is one list, most urgent first:
    // Brandon, 25 Sept 2026, "only 'Fire' alerts go there. Then a section for
    // everything else."
    { title: 'Pressing', items: open.filter((c) => c.urgency === 'NOW'), empty: 'Nothing pressing.' },
    { title: 'Everything else', items: [...open.filter((c) => c.urgency === 'TODAY'), ...open.filter((c) => c.urgency === 'DIGEST')] },
    { title: 'Waiting', items: cases.filter((c) => c.status === 'WAITING_ON_CUSTOMER' || c.status === 'WAITING_ON_RETURN') },
    { title: 'Closed in the last two weeks', items: cases.filter((c) => c.status === 'RESOLVED') },
  ]

  return (
    <Page title="Support" lede="Customer email to support@cleocamp.com, sorted by Mouse, with a reply drafted. Nothing reaches a customer until someone taps Send.">
      {groups.map((g) =>
        g.items.length || g.empty ? (
          <Card key={g.title} title={`${g.title}${g.items.length ? ` (${g.items.length})` : ''}`}>
            {g.items.length ? (
              <ul className="divide-y divide-line">
                {g.items.map((c) => <SupportCase key={c.id} c={view(c)} />)}
              </ul>
            ) : (
              <Empty>{g.empty}</Empty>
            )}
          </Card>
        ) : null,
      )}
    </Page>
  )
}
