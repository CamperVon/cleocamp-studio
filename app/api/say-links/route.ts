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
export async function POST(req: NextRequest) {
  const { personId } = (await req.json()) as { personId?: string }
  if (!personId) return NextResponse.json({ error: 'personId required' }, { status: 400 })

  const person = await db.person.findUnique({
    where: { id: personId },
    select: { id: true, name: true, active: true, sayToken: true },
  })
  if (!person || !person.active) {
    return NextResponse.json({ error: 'no such person' }, { status: 404 })
  }

  const token = mintSayToken()
  await db.person.update({ where: { id: person.id }, data: { sayToken: token } })

  const origin = req.nextUrl.origin
  return NextResponse.json({
    name: person.name,
    replaced: Boolean(person.sayToken),
    link: `${origin}/say?k=${token}`,
    // Everything the Siri shortcut needs, so nobody has to assemble it from
    // parts or be told what a bearer token is.
    siri: { url: `${origin}/api/say?format=text`, header: `Bearer ${token}` },
  })
}

export async function DELETE(req: NextRequest) {
  const { personId } = (await req.json()) as { personId?: string }
  if (!personId) return NextResponse.json({ error: 'personId required' }, { status: 400 })
  await db.person.update({ where: { id: personId }, data: { sayToken: null } })
  return NextResponse.json({ ok: true })
}
