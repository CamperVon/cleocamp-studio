import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { mintSayToken } from '@/lib/say-core'

/**
 * Mint someone's personal "tell Mouse" link.
 *
 * Behind the app's shared password like everything else — the proxy matches
 * /api/say exactly, so this neighbouring path is still protected. That is the
 * point of it: whoever already has the admin password can set up a phone
 * without the secret passing through anyone else's hands, an email, or a chat
 * transcript. The value is returned once, to the browser that asked, and is
 * not readable again afterwards.
 */
/** The two links plus the Siri header, for a token that already exists. */
function linksFor(origin: string, token: string) {
  return {
    link: `${origin}/enter?k=${token}&to=say`,
    desktopLink: `${origin}/enter?k=${token}`,
    siri: { url: `${origin}/api/say?format=text`, header: `Bearer ${token}` },
  }
}

/**
 * Show the links somebody already has.
 *
 * These used to be shown once at minting and never again, which was a reflex
 * rather than a decision: the token is stored in plain text on the Person row,
 * so refusing to display it on a page already behind the admin password
 * protected nothing and meant the only way to see a link again was to replace
 * it — cutting off the phone that was working in order to read the address of
 * the one that was. Brandon, 21 Sept 2026, asking where the desktop links
 * were, having already had a link minted before desktop links existed.
 */
export async function GET(req: NextRequest) {
  const personId = req.nextUrl.searchParams.get('personId')
  if (!personId) return NextResponse.json({ error: 'personId required' }, { status: 400 })

  const person = await db.person.findUnique({
    where: { id: personId },
    select: { name: true, active: true, external: true, sayToken: true },
  })
  if (!person || !person.active || person.external) {
    return NextResponse.json({ error: 'no such person' }, { status: 404 })
  }
  if (!person.sayToken) {
    return NextResponse.json({ error: 'no link yet' }, { status: 404 })
  }
  return NextResponse.json({
    name: person.name,
    replaced: false,
    ...linksFor(req.nextUrl.origin, person.sayToken),
  })
}

export async function POST(req: NextRequest) {
  const { personId } = (await req.json()) as { personId?: string }
  if (!personId) return NextResponse.json({ error: 'personId required' }, { status: 400 })

  const person = await db.person.findUnique({
    where: { id: personId },
    select: { id: true, name: true, active: true, external: true, sayToken: true },
  })
  // Hiding someone from the page is not the same as refusing them a key. The
  // page could be stale, or the id typed by hand; the refusal belongs here.
  if (!person || !person.active || person.external) {
    return NextResponse.json({ error: 'no such person' }, { status: 404 })
  }

  const token = mintSayToken()
  await db.person.update({ where: { id: person.id }, data: { sayToken: token } })

  // Two links, one secret. Both sign them in as themselves; they differ only
  // in where they land, and a phone and a desktop want different places.
  return NextResponse.json({
    name: person.name,
    replaced: Boolean(person.sayToken),
    ...linksFor(req.nextUrl.origin, token),
  })
}

export async function DELETE(req: NextRequest) {
  const { personId } = (await req.json()) as { personId?: string }
  if (!personId) return NextResponse.json({ error: 'personId required' }, { status: 400 })
  await db.person.update({ where: { id: personId }, data: { sayToken: null } })
  return NextResponse.json({ ok: true })
}
