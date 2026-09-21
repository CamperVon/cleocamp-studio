import { db } from '@/lib/db'
import { Page, Card, Empty } from '@/app/ui/primitives'
import { PhoneSetup } from './phone-setup'

export const dynamic = 'force-dynamic'

/**
 * Who can tell Mouse things from their phone, and how to set someone up.
 *
 * Behind the app's shared password, so anyone already trusted with that can
 * hand out a link without a secret travelling through a chat, an email, or a
 * person relaying it. Each link is shown once, to the browser that asked for
 * it, and is unreadable afterwards — creating a new one replaces the old.
 */
export default async function Phones() {
  const people = await db.person.findMany({
    where: { active: true },
    select: { id: true, name: true, role: true, sayToken: true },
    orderBy: { name: 'asc' },
  })

  return (
    <Page
      title="Phones"
      lede="Tell Mouse something without opening the app — from the car, the studio floor, anywhere."
    >
      <Card title="How it works">
        <div className="space-y-3 px-4 py-4 text-sm leading-relaxed sm:px-5">
          <p>
            Each person gets their own link. Opening it once on their phone saves it there, and
            the link clears itself out of the address bar. After that it is one tap from the
            home screen, and the keyboard&rsquo;s microphone does the talking.
          </p>
          <p className="text-faint">
            The link is a password. Send it the way you would send one, and only to the person it
            belongs to. Making a new link for someone switches off their old one straight away,
            which is also how you take a phone away.
          </p>
        </div>
      </Card>

      <Card title="Everyone">
        {people.length ? (
          <ul className="divide-y divide-line">
            {people.map((p) => (
              <li key={p.id} className="px-4 py-4 sm:px-5">
                <PhoneSetup
                  personId={p.id}
                  name={p.name}
                  role={p.role}
                  alreadySetUp={Boolean(p.sayToken)}
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
