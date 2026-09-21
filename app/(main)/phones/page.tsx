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
  // Cleo Camp's own people only. Nicki works for Antonio's — she belongs on
  // purchase orders and in vendor notes, not on the list of who gets a key to
  // this app. Brandon, 21 Sept 2026.
  const people = await db.person.findMany({
    where: { active: true, external: false },
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
            Each person gets their own link, and it does two things. It signs them into the app
            as themselves, so what they write down carries their name instead of appearing from
            nowhere. And it sets up the dictate screen, so they can tell Mouse something without
            opening anything &mdash; from the car, the studio floor, anywhere.
          </p>
          <p>
            Opening it once on their phone saves both, and the link clears itself out of the
            address bar. Then Share &rarr; Add to Home Screen. The keyboard&rsquo;s microphone
            does the talking.
          </p>
          <p className="text-faint">
            The shared password still works and always will. Anyone using it is simply anonymous,
            the way everyone was until now, and nothing stops working for them.
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
