import { Page } from '@/app/ui/primitives'
import { ContactList } from '@/app/ui/contact-list'
import { listContacts } from '@/lib/contacts'

export const dynamic = 'force-dynamic'

/**
 * Cleo Crew: everyone working for and with Cleo (Brandon, 1 Oct 2026). The
 * team, then the Friends We Like to Work With (photographers, sample makers).
 */
export default async function Crew() {
  const [all, removed] = await Promise.all([listContacts(['CREW', 'WORKS_WITH']), listContacts(['CREW', 'WORKS_WITH'], { removed: true })])
  const of = (c: string, rows: typeof all) => rows.filter((p) => p.circle === c)
  return (
    <Page title="Cleo Crew" lede="Everyone working for and with Cleo. Add here, or tell Mouse.">
      <ContactList title="Internal" circle="CREW" people={of('CREW', all)} removed={of('CREW', removed)} />
      <ContactList title="Friends We Like to Work With" circle="WORKS_WITH" people={of('WORKS_WITH', all)} removed={of('WORKS_WITH', removed)} />
    </Page>
  )
}
