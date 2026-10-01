import { Page } from '@/app/ui/primitives'
import { ContactList } from '@/app/ui/contact-list'
import { listContacts } from '@/lib/contacts'

export const dynamic = 'force-dynamic'

/** Friends of the Brand: press, editors, artists (Brandon, 1 Oct 2026). A to Z. */
export default async function Friends() {
  const [people, removed] = await Promise.all([listContacts(['FRIEND_OF_BRAND']), listContacts(['FRIEND_OF_BRAND'], { removed: true })])
  return (
    <Page title="Friends of the Brand" lede="Press, editors and friends. Add here, or tell Mouse.">
      <ContactList title="Friends of the Brand" circle="FRIEND_OF_BRAND" people={people} removed={removed} />
    </Page>
  )
}
