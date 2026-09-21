import { headers } from 'next/headers'
import { db } from '@/lib/db'
import { Page, Card, Empty } from '@/app/ui/primitives'
import { PhoneSetup } from './phone-setup'

export const dynamic = 'force-dynamic'

/**
 * Everyone's links, on the page, always.
 *
 * They were behind a button at first, and before that shown once at minting
 * and never again — a reflex rather than a decision, since the token sits in
 * plain text on the Person row and this page is already behind the admin
 * password. Hiding it protected nothing and meant the only way to see a link
 * again was to replace it. Brandon, 21 Sept 2026: "put the link on the links
 * page so i can always find them."
 */
export default async function Phones() {
  // Cleo Camp's own people only. Nicki works for Antonio's — she belongs on
  // purchase orders and in vendor notes, not on the list of who gets a key to
  // this app.
  const people = await db.person.findMany({
    where: { active: true, external: false },
    select: { id: true, name: true, role: true, sayToken: true },
    orderBy: { name: 'asc' },
  })

  // Absolute, because these get copied into a message and opened on a device
  // that has no idea what this page's origin was.
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  const origin = `${proto}://${host}`

  return (
    <Page
      title="Phones"
      lede="Give someone their own link and Mouse knows who it is talking to. Treat a link like a password."
    >
      <Card title="Everyone">
        {people.length ? (
          <ul className="divide-y divide-line">
            {people.map((p) => (
              <li key={p.id} className="px-4 py-4 sm:px-5">
                <PhoneSetup
                  personId={p.id}
                  name={p.name}
                  role={p.role}
                  origin={origin}
                  token={p.sayToken}
                />
              </li>
            ))}
          </ul>
        ) : (
          <Empty>Nobody on file yet.</Empty>
        )}
      </Card>
    </Page>
  )
}
