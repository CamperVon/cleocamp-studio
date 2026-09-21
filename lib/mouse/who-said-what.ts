import { db } from '@/lib/db'
import { laMidnight } from '@/lib/dates'
import { escapeHtml } from '@/lib/mouse/daily-cheese'

/**
 * What everyone else told Mouse, and what came of it.
 *
 * Brandon, 21 Sept 2026, once other people could reach Mouse from their own
 * phones: "could it email me everything other users posted, so I'm aware."
 * Fair. He is the one who notices when something looks wrong, and updates
 * arriving from four phones are otherwise invisible to him — they land in the
 * record, correctly, and nobody tells him they happened.
 *
 * WHAT WAS RECORDED MATTERS AS MUCH AS WHAT WAS SAID. Each entry carries both,
 * because the interesting failure is not "Cleo said something" but "Cleo said
 * something and nothing was written down". That gap is invisible in a list of
 * quotes and obvious in a list of pairs, and this session has now met it three
 * times in other guises.
 */

export type Said = {
  person: string
  at: Date
  said: string
  /** Summaries of what Mouse actually wrote in response. Empty is meaningful. */
  recorded: string[]
  /** Mouse's reply, trimmed — enough to see whether it asked something back. */
  replied: string
}

/** Turns "[Cleo, Founder] the cotton arrived" into its two halves. */
export function splitAuthored(content: string): { person: string; said: string } | null {
  const m = /^\[([^\],]+?)(?:,[^\]]*)?\]\s*([\s\S]*)$/.exec(content)
  if (!m) return null
  const person = m[1].trim()
  const said = m[2].trim()
  if (!person || !said) return null
  return { person, said }
}

/**
 * Everything authored by a named person since yesterday's Pacific midnight.
 *
 * The window starts a day back rather than at today's midnight because this
 * runs at 5am: anything said yesterday evening would otherwise fall in the gap
 * between two nights' emails and be reported by neither.
 */
export async function whoSaidWhat(excludeNames: string[] = []): Promise<Said[]> {
  const since = laMidnight(1)
  const skip = new Set(excludeNames.map((n) => n.trim().toLowerCase()).filter(Boolean))

  const messages = await db.chatMessage.findMany({
    where: { createdAt: { gte: since }, role: 'USER', content: { startsWith: '[' } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, threadId: true, content: true, createdAt: true },
  })

  const out: Said[] = []
  for (const m of messages) {
    const split = splitAuthored(m.content)
    if (!split) continue
    if (skip.has(split.person.toLowerCase())) continue

    // Mouse's answer is the next assistant turn in the same thread. Its tool
    // calls are what actually reached the record.
    const reply = await db.chatMessage.findFirst({
      where: { threadId: m.threadId, role: 'ASSISTANT', createdAt: { gt: m.createdAt } },
      orderBy: { createdAt: 'asc' },
      select: { content: true, toolCallsJson: true },
    })

    const calls = Array.isArray(reply?.toolCallsJson) ? reply.toolCallsJson : []
    const recorded = (calls as Array<{ name?: string; status?: string; isWrite?: boolean; summary?: string }>)
      .filter((c) => c?.isWrite && c.status === 'succeeded')
      .map((c) => c.summary ?? String(c.name ?? 'wrote something'))

    out.push({
      person: split.person,
      at: m.createdAt,
      said: split.said,
      recorded,
      replied: (reply?.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 400),
    })
  }
  return out
}

const timeLA = (d: Date) =>
  d.toLocaleString('en-GB', {
    timeZone: 'America/Los_Angeles',
    weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
  })

/** Grouped by person, in the order they first spoke. */
function group(items: Said[]): Array<{ person: string; items: Said[] }> {
  const by = new Map<string, Said[]>()
  for (const i of items) {
    const list = by.get(i.person)
    if (list) list.push(i)
    else by.set(i.person, [i])
  }
  return [...by.entries()].map(([person, list]) => ({ person, items: list }))
}

export function renderWhoSaidWhat(items: Said[]): { subject: string; text: string; html: string } {
  const groups = group(items)
  const people = groups.map((g) => g.person)
  const subject =
    people.length === 1
      ? `What ${people[0]} told Mouse`
      : `What ${people.slice(0, -1).join(', ')} and ${people[people.length - 1]} told Mouse`

  const text = groups
    .map((g) =>
      [
        `${g.person.toUpperCase()}`,
        ...g.items.map((i) =>
          [
            `  ${timeLA(i.at)} — ${i.said}`,
            i.recorded.length
              ? i.recorded.map((r) => `    recorded: ${r}`).join('\n')
              : '    NOTHING WAS RECORDED for this one.',
          ].join('\n'),
        ),
      ].join('\n\n'),
    )
    .join('\n\n')

  const rows = groups
    .map(
      (g) => `
      <div style="margin-top:22px;">
        <div style="font-size:11.5px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:#726B5E;margin-bottom:6px;">${escapeHtml(g.person)}</div>
        ${g.items
          .map(
            (i) => `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
               style="border-collapse:separate;border-radius:10px;background:#FFFFFF;border:1px solid #E2DCCC;margin-top:8px;">
          <tr>
            <td style="padding:12px 14px;">
              <div style="font-size:11px;color:#8F887A;margin-bottom:4px;">${escapeHtml(timeLA(i.at))}</div>
              <div style="font-size:14px;line-height:1.5;color:#1C1B19;">${escapeHtml(i.said)}</div>
              ${
                i.recorded.length
                  ? `<div style="margin-top:9px;padding-top:8px;border-top:1px solid #EDE8DB;font-size:12px;color:#5C6663;">
                       ${i.recorded.map((r) => `<div style="margin-top:2px;">&#10003; ${escapeHtml(r)}</div>`).join('')}
                     </div>`
                  : `<div style="margin-top:9px;padding-top:8px;border-top:1px solid #EFC8C0;font-size:12px;color:#AE3527;">
                       Nothing was written down for this one.
                     </div>`
              }
            </td>
          </tr>
        </table>`,
          )
          .join('')}
      </div>`,
    )
    .join('')

  const html = `<!doctype html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;background:#F1EDE3;color:#1C1B19;font-family:Arial,Helvetica,sans-serif;padding:24px 12px;">
  <div style="max-width:560px;margin:0 auto;background:#FBF8F0;border:1px solid #E2DCCC;border-radius:14px;overflow:hidden;">
    <div style="padding:24px 22px 22px;">
      <div style="text-align:center;padding-bottom:16px;border-bottom:1px solid #EDE8DB;">
        <div style="font-weight:700;font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#3A342A;">Told to Mouse</div>
        <div style="font-size:13px;color:#726B5E;margin-top:6px;">${items.length} update${items.length === 1 ? '' : 's'} since yesterday morning</div>
      </div>
      ${rows}
      <div style="margin-top:26px;padding-top:16px;border-top:1px solid #EDE8DB;font-size:12.5px;color:#726B5E;">
        Each one shows what was said and what reached the record. A red line means
        it was said and nothing was written down &mdash; worth a look.
      </div>
    </div>
  </div>
</body></html>`

  return { subject, text, html }
}
