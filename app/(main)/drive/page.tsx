import { Card, Fold, Page } from '@/app/ui/primitives'
import { driveSections, STYLE_FOLDERS } from '@/lib/drive'
import { AddDriveLink, DriveSearch, Unpin } from './drive-controls'

export const dynamic = 'force-dynamic'

/**
 * Drive: the team's Google Drive pages one tap away (Brandon, 19 Nov 2026).
 * See lib/drive.ts. Sections fold closed (Brandon, 28 Sept 2026), with the
 * count on the closed line.
 */
export default async function Drive() {
  const sections = await driveSections()
  return (
    <Page title="Drive" lede="Google Drive pages one tap away, by section. Search opens Google Drive in a new tab, signed in as you. Add a link here, or tell Mouse to put one on the Drive page.">
      <Card>
        <DriveSearch />
        <div className="border-t border-line px-4 py-2.5 text-xs sm:px-5">
          <a href="https://drive.google.com/drive/my-drive" target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2">Open Google Drive ↗</a>
        </div>
      </Card>
      <Card title="Pages">
        {sections.length ? (
          <ul className="divide-y divide-line">
            {sections.map((s) => (
              <li key={s.name}>
                <Fold summary={<span className="flex items-baseline justify-between gap-3"><span className="font-medium">{s.name}</span><span className="text-xs text-muted">{s.links.length}</span></span>}>
                  <ul className="flex flex-col gap-2 px-4 pb-3 pl-10 sm:px-5 sm:pl-11">
                    {s.links.map((l) => (
                      <li key={`${s.name}:${l.id}`} className="flex items-baseline justify-between gap-3">
                        <a href={l.url} target="_blank" rel="noreferrer" className="min-w-0 text-sm text-accent underline underline-offset-2">
                          {l.title} <span className="text-xs text-muted no-underline">· {l.kind} ↗</span>
                        </a>
                        {l.pinId ? <Unpin pinId={l.pinId} /> : null}
                      </li>
                    ))}
                  </ul>
                </Fold>
              </li>
            ))}
          </ul>
        ) : <p className="px-4 py-3 text-sm text-muted sm:px-5">No links yet. Add one below.</p>}
      </Card>
      <Card>
        <Fold summary={<span className="text-sm font-medium text-accent">+ Add a Drive link</span>}>
          <AddDriveLink sections={sections.map((s) => s.name).filter((n) => n !== STYLE_FOLDERS)} />
        </Fold>
      </Card>
    </Page>
  )
}
