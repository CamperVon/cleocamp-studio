import { db } from '@/lib/db'
import { Card, Chip, Empty, Fold, Page } from '@/app/ui/primitives'
import { CATEGORIES, LINES } from '@/lib/style-system'

export const dynamic = 'force-dynamic'

/**
 * How style numbers work (Prompt 4, Part 3, 16 Oct 2026): the system in plain
 * words, for the team, on a phone. The rules are written here; the style list
 * and the patterns at the bottom are read from the database, so they are
 * always what the app holds. docs/style-system/style-system.md is the same
 * system for a developer.
 */

const STATUS_TONE: Record<string, 'accent' | 'warn' | 'neutral'> = { ACTIVE: 'accent', PROPOSED: 'warn' }

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card title={title}>
      <div className="flex flex-col gap-2.5 px-4 py-3 text-sm leading-relaxed sm:px-5">{children}</div>
    </Card>
  )
}

const Code = ({ children }: { children: React.ReactNode }) => <span className="font-mono font-medium">{children}</span>

export default async function StyleNumbers() {
  const [styles, retired] = await Promise.all([
    db.style.findMany({
      orderBy: { number: 'asc' },
      select: {
        number: true, name: true, status: true, categoryCode: true,
        products: { orderBy: { name: 'asc' }, select: { name: true, _count: { select: { variants: true } } } },
        patterns: { orderBy: { code: 'asc' }, select: { code: true, description: true, fabric: true, heldBy: true, status: true } },
      },
    }),
    db.retiredStyleNumber.count(),
  ])
  const tee = styles.find((s) => s.number === 'TCO101')
  const byCategory = CATEGORIES.map((c) => ({ ...c, styles: styles.filter((s) => s.categoryCode === c.code) })).filter((c) => c.styles.length)
  const uncategorised = styles.filter((s) => !CATEGORIES.some((c) => c.code === s.categoryCode))

  return (
    <Page title="How style numbers work" lede="Every product has a style number, and every size and colour of it has a SKU built from that number. Here's how to read one, and how a new one gets made.">
      <Section title="Reading a SKU">
        <p className="rounded-lg bg-sunk px-3 py-2.5 text-base"><Code>TCO101-BLK-01</Code></p>
        <p>Read out loud: <strong>Tee, Cleo Original, women&apos;s, first version, Black, size 1.</strong></p>
        <ul className="flex flex-col gap-1.5">
          <li><Code>T</Code> the category: tees.</li>
          <li><Code>CO</Code> the product, from its name: Cleo Original.</li>
          <li><Code>1</Code> the line: women&apos;s.</li>
          <li><Code>01</Code> the version: the first one.</li>
          <li><Code>BLK</Code> the colour: Black.</li>
          <li><Code>01</Code> the size: size 1.</li>
        </ul>
        <p className="text-muted">The first six characters (<Code>TCO101</Code>) are the style number. The colour and size after it make the SKU. Season and year are never in the code.</p>
      </Section>

      <Card title="The first letter: category">
        <ul className="divide-y divide-line text-sm">
          {CATEGORIES.map((c) => (
            <li key={c.code} className="flex items-baseline gap-3 px-4 py-2 sm:px-5">
              <span className="w-5 font-mono font-medium">{c.code}</span>
              <span className="flex-1">{c.name}</span>
              {c.reserved ? <span className="text-xs text-faint">reserved, not in use yet</span> : null}
            </li>
          ))}
        </ul>
      </Card>

      <Section title="The digits: line and version">
        <p>The first digit is the line: {Object.entries(LINES).map(([d, n], i, a) => <span key={d}><Code>{d}</Code> {n}{i < a.length - 2 ? ', ' : i === a.length - 2 ? ' and ' : ''}</span>)}. Everything we make today is <Code>1</Code>. Unisex is set aside for later.</p>
        <p>The last two digits are the version, starting at <Code>01</Code>. It only goes up for a redesign a customer would see as a different version: a new neckline, a new length. A Cleo Tee with a new neckline would be <Code>TCO102</Code>.</p>
        <p>It never goes up for a new colour, and never for a pattern revision.</p>
      </Section>

      <Section title="Style, colourway, size">
        <p><strong>A style</strong> is a pattern plus how it&apos;s built. It gets the style number.</p>
        <p><strong>A colourway</strong> is the same style in another colour or material. It keeps the style number and gets its own colour code.</p>
        <p><strong>A size</strong> is the last part of the SKU. It keeps the style number too.</p>
        <p>Example: the <strong>Cleo Bag in Olive</strong> is a colourway of <Code>HCB101</Code>, because it&apos;s the same pattern and build as Black, Chocolate and Silver. The <strong>Cleo Bag in Denim</strong> is double-lined, a different build and cost, so it&apos;s its own style, <Code>HCD101</Code>.</p>
        <p><strong>A collaboration gets its own style.</strong> The Cleo Tee made with Wilde&apos;s LA is <Code>TCW101</Code>, not a colour of the Cleo Tee.</p>
      </Section>

      <Section title="Pattern labels">
        <p>A style can have more than one physical pattern. Each one is labelled with the style number, then <Code>-P</Code> and a number: <Code>TCO101-P1</Code>, <Code>TCO101-P2</Code>. The first pattern of every style is P1.</p>
        <p>The label goes on the pattern pieces, the digital pattern files and purchase-order lines, where the factory reads &quot;Pattern: TCO101-P2&quot; under the line. When a style has one pattern, the order fills it in. When it has two, the order can&apos;t be sent until you tell Mouse which.</p>
        <p><strong>A pattern label is never part of a SKU</strong>, never a colour or size, and never goes to Shopify. A new pattern doesn&apos;t change the style number.</p>
        <p className="rounded-lg bg-sunk px-3 py-2.5">Cleo Tee today: <strong>PFD fabric → P2</strong>, <strong>pre-washed fabric → P1</strong>.</p>
        {tee?.patterns.length ? (
          <ul className="flex flex-col gap-1.5">
            {tee.patterns.map((p) => (
              <li key={p.code}><Code>{p.code}</Code> {p.description} <span className="text-muted">Held by {p.heldBy ?? 'not recorded yet'} · {p.status.toLowerCase()}</span></li>
            ))}
          </ul>
        ) : null}
      </Section>

      <Section title="Making a new style number">
        <p>Tell Mouse in chat, for example: &quot;New style: the Cleo Skirt, a bottom, letters CS.&quot; Say the category and the two letters you want; Mouse can suggest letters from the name.</p>
        <p>The number starts as <strong>proposed</strong>. It becomes real when Brandon or Cleo confirms it. Mouse never makes one up, and if it&apos;s not clear whether something is a new style or a new colour of an old one, it asks.</p>
        <p>A number is never used twice, including the old ones. {retired ? <>The {retired} numbers from before 16 Oct (TP101 and the rest) are <a href="/style-numbers/crosswalk" className="text-accent underline underline-offset-2">listed here, with what replaced them</a>, and still find their product in search.</> : <>The old numbers (TP101 and the rest) are <a href="/style-numbers/crosswalk" className="text-accent underline underline-offset-2">listed here</a>.</>}</p>
      </Section>

      <Card title={`All styles (${styles.length})`}>
        {styles.length === 0 ? <Empty>No styles yet.</Empty> : (
          <ul className="divide-y divide-line">
            {[...byCategory.map((c) => ({ key: c.code, name: `${c.code} · ${c.name}`, styles: c.styles })), ...(uncategorised.length ? [{ key: '?', name: 'Not in a category yet', styles: uncategorised }] : [])].map((g) => (
              <li key={g.key}>
                <Fold summary={<span className="text-sm">{g.name} <span className="text-muted">({g.styles.length})</span>{g.styles.some((s) => s.status === 'PROPOSED') ? <span className="text-warn"> · proposed to confirm</span> : null}</span>}>
                  <ul className="px-4 pb-3 sm:px-5">
                    {g.styles.map((s) => (
                      <li key={s.number} className="flex flex-col gap-0.5 border-t border-line py-2 text-sm">
                        <span className="flex flex-wrap items-baseline gap-x-2">
                          <Code>{s.number}</Code>
                          <span className="flex-1">{s.name}</span>
                          <Chip tone={STATUS_TONE[s.status] ?? 'neutral'}>{s.status.toLowerCase().replace('_', ' ')}</Chip>
                        </span>
                        {s.products.length > 1 || (s.products[0] && s.products[0].name !== s.name)
                          ? <span className="text-xs text-muted">{s.products.map((p) => p.name).join(', ')}</span> : null}
                        {s.patterns.length ? <span className="text-xs text-muted">Patterns: {s.patterns.map((p) => `${p.code}${p.status !== 'ACTIVE' ? ` (${p.status.toLowerCase()})` : ''}`).join(', ')}</span> : null}
                      </li>
                    ))}
                  </ul>
                </Fold>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </Page>
  )
}
