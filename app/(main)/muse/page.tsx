import { db } from '@/lib/db'
import { Card, Empty, Fold, Page } from '@/app/ui/primitives'
import { settleTeamAnswers, type MuseSource } from '@/lib/muse'

export const dynamic = 'force-dynamic'

const STATE: Record<string, string> = { OPEN: 'with Muse', REPORTED: 'reported', CLOSED: 'closed', CANCELLED: 'cancelled' }
const day = (d: Date) => d.toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric' })

/**
 * Research handed to Muse, the team's outside researcher (lib/muse.ts).
 * Ask Mouse to hand something over, close it or cancel it; this page shows
 * what was sent, what Muse asked, and what it found.
 */
export default async function MusePage() {
  const rows = await db.museTask.findMany({
    orderBy: { createdAt: 'desc' }, take: 40,
    include: { questions: { orderBy: { createdAt: 'asc' } } },
  })
  const tasks = await Promise.all(rows.map((t) => settleTeamAnswers(t)))
  return (
    <Page title="Muse" lede="Research Mouse has handed to Muse, the outside researcher. Muse reports; it never changes anything here. Ask Mouse to hand something over.">
      <Card title={`Tasks (${tasks.length})`}>
        {tasks.length === 0 ? <Empty>Nothing handed to Muse yet. Try: “Mouse, have Muse look for a better price on the black silk.”</Empty> : (
          <ul className="divide-y divide-line">
            {tasks.map((t) => {
              const waiting = t.questions.filter((q) => q.status !== 'ANSWERED').length
              const sources = (Array.isArray(t.sources) ? t.sources : []) as MuseSource[]
              return (
                <li key={t.id} data-rec={t.id}>
                  <Fold summary={
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-medium">Task {t.number}: {t.title}</span>
                      <span className="text-xs text-muted">{STATE[t.status] ?? t.status.toLowerCase()} · {day(t.reportedAt ?? t.createdAt)}</span>
                      {waiting ? <span className="text-xs font-semibold text-accent">{waiting} question{waiting === 1 ? '' : 's'} for you</span> : null}
                    </span>
                  }>
                    <div className="space-y-4 px-4 pb-4 text-sm sm:px-5">
                      {t.summary ? (
                        <section>
                          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Muse found</h3>
                          <p className="mt-1 whitespace-pre-wrap">{t.summary}</p>
                          <p className="mt-1 text-xs text-faint">Web research by Muse, not checked by us.</p>
                        </section>
                      ) : null}
                      {sources.length ? (
                        <section>
                          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Sources</h3>
                          <ul className="mt-1 space-y-1">
                            {sources.map((s, n) => (
                              <li key={n}>
                                <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="underline">{s.name}</a>
                                {s.price ? <span className="text-muted"> · {s.price}{s.currency ? ` ${s.currency}` : ''}{s.unit ? `/${s.unit}` : ''}</span> : null}
                                {s.notes ? <span className="text-muted"> · {s.notes}</span> : null}
                              </li>
                            ))}
                          </ul>
                        </section>
                      ) : null}
                      {t.report ? (
                        <details>
                          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted">Full report</summary>
                          <div className="mt-2 whitespace-pre-wrap rounded-lg bg-sunk p-3 text-[13px] leading-relaxed">{t.report}</div>
                        </details>
                      ) : null}
                      {t.reportFileId ? <a href={`/files/${t.reportFileId}`} className="inline-block text-xs underline">Muse&apos;s PDF</a> : null}
                      {t.questions.length ? (
                        <section>
                          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Muse asked</h3>
                          <ul className="mt-1 space-y-2">
                            {t.questions.map((q) => (
                              <li key={q.id}>
                                <p>{q.question}</p>
                                <p className="text-muted">{q.status === 'ANSWERED' ? `→ ${q.answer}` : '→ waiting on you, in To-do'}</p>
                              </li>
                            ))}
                          </ul>
                        </section>
                      ) : null}
                      <details>
                        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted">What Mouse sent</summary>
                        <div className="mt-2 whitespace-pre-wrap rounded-lg bg-sunk p-3 text-[13px] leading-relaxed">{t.brief}</div>
                      </details>
                    </div>
                  </Fold>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </Page>
  )
}
