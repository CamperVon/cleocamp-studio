import { Card, Fold, Page } from '@/app/ui/primitives'
import { db } from '@/lib/db'
import { FILE_TYPES, linkTargets, recordHref, sizeLabel } from '@/lib/files'
import { FileDetails, UploadFile } from './file-controls'

export const dynamic = 'force-dynamic'

/**
 * Files: documents kept for good, each linked to the products, components and
 * vendors it is about, and shown on their rows (Brandon, 6 Oct 2026: "a back
 * area for things like this, linked via the products / components pages").
 */
export default async function Files() {
  const [files, targets] = await Promise.all([
    db.storedFile.findMany({
      orderBy: { title: 'asc' },
      select: { id: true, title: true, filename: true, mediaType: true, sizeBytes: true, notes: true, createdAt: true, links: { select: { id: true, kind: true, recordId: true } } },
    }),
    linkTargets(),
  ])
  // Names for every linked record, including any no longer active.
  const ids = (k: string) => [...new Set(files.flatMap((f) => f.links.filter((l) => l.kind === k).map((l) => l.recordId)))]
  const [ps, cs, vs] = await Promise.all([
    db.product.findMany({ where: { id: { in: ids('product') } }, select: { id: true, name: true } }),
    db.component.findMany({ where: { id: { in: ids('component') } }, select: { id: true, name: true } }),
    db.vendor.findMany({ where: { id: { in: ids('vendor') } }, select: { id: true, name: true } }),
  ])
  const name = new Map([...ps, ...cs, ...vs].map((r) => [r.id, r.name]))

  return (
    <Page title="Files" lede="Colour cards, spec sheets and the like, kept for good. Each shows on the rows it is linked to. Tell Mouse to keep a file you send it, or add one here.">
      <Card>
        <Fold summary={<span className="text-sm font-medium text-accent">+ Keep a file</span>}>
          <UploadFile targets={targets} />
        </Fold>
      </Card>
      <Card title={`Kept (${files.length})`}>
        {files.length ? (
          <ul className="divide-y divide-line">
            {files.map((f) => (
              <li key={f.id} data-rec={f.id}>
                <Fold summary={
                  <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                    <span className="font-medium">{f.title}</span>
                    <span className="text-xs text-muted">
                      {FILE_TYPES[f.mediaType] ?? 'file'} · {sizeLabel(f.sizeBytes)} · {f.links.length ? `${f.links.length} linked` : <span className="text-warn">not linked</span>}
                    </span>
                  </span>
                }>
                  <FileDetails
                    file={{ id: f.id, title: f.title, notes: f.notes }}
                    links={f.links.map((l) => ({ id: l.id, name: name.get(l.recordId) ?? l.recordId, href: recordHref(l.kind, l.recordId) }))}
                    targets={targets}
                  />
                </Fold>
              </li>
            ))}
          </ul>
        ) : <p className="px-4 py-3 text-sm text-muted sm:px-5">Nothing kept yet.</p>}
      </Card>
    </Page>
  )
}
