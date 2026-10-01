import { Card, Fold } from '@/app/ui/primitives'
import { ContactDetails, NewContact, PutBack, type ContactInfo } from '@/app/ui/contact-controls'

/**
 * One list of people (a circle), A to Z, folded closed like every list here
 * (CLAUDE.md §5): the section, then each person, with "+ Add" in pink at the end (Brandon, 1 Oct 2026).
 */
export function ContactList({ title, circle, people, removed }: { title: string; circle: string; people: ContactInfo[]; removed: ContactInfo[] }) {
  return (
    <Card>
      <Fold summary={
        <span className="flex items-center justify-between gap-3">
          <span className="font-serif text-[17px] italic text-accent">{title}</span>
          <span className="text-xs text-muted">{people.length}</span>
        </span>
      }>
        {people.length ? (
          <ul className="divide-y divide-line border-t border-line">
            {people.map((p) => (
              <li key={p.id}>
                <Fold summary={
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium">{p.name}</span>
                    {p.role || p.company ? <span className="text-xs text-muted">{[p.role, p.company].filter(Boolean).join(', ')}</span> : null}
                  </span>
                }>
                  <div className="px-4 pb-3.5 sm:px-5"><ContactDetails f={p} /></div>
                </Fold>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="border-t border-line">
          <Fold summary={<span className="text-sm font-medium text-accent">+ Add</span>}>
            <div className="px-4 pb-3.5 sm:px-5"><NewContact circle={circle} /></div>
          </Fold>
        </div>
        {removed.length ? (
          <div className="border-t border-line">
            <Fold summary={<span className="text-xs text-muted">Removed ({removed.length})</span>}>
              <ul className="flex flex-col gap-1.5 px-4 pb-3.5 sm:px-5">{removed.map((r) => <PutBack key={r.id} id={r.id} name={r.name} />)}</ul>
            </Fold>
          </div>
        ) : null}
      </Fold>
    </Card>
  )
}
