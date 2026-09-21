import { db } from '@/lib/db'
import { mintSayToken } from '@/lib/say'

/**
 * Give someone a way to tell Mouse things from their phone.
 *
 *   npx tsx scripts/say-token.ts "Brandon"        mint, or rotate an existing one
 *   npx tsx scripts/say-token.ts --list           who has one (never the value)
 *   npx tsx scripts/say-token.ts "Jane" --revoke  take it away
 *
 * The token IS the authentication on those doors, so minting prints it once,
 * here, and nowhere else. It is not recoverable afterwards — rotate and hand
 * over a new link rather than trying to read an old one back. CLAUDE.md §2
 * is about .env specifically, but the reasoning is the same: a secret that
 * gets echoed into a terminal, a chat or a log has stopped being one.
 */
async function main() {
  const args = process.argv.slice(2)
  const base = process.env.APP_URL ?? 'https://cleocamp-studio.vercel.app'

  if (args.includes('--list')) {
    const people = await db.person.findMany({
      where: { active: true },
      select: { name: true, role: true, sayToken: true },
      orderBy: { name: 'asc' },
    })
    console.log('Who can tell Mouse things from their phone:\n')
    for (const p of people) {
      console.log(`  ${p.sayToken ? '✓' : ' '} ${p.name}${p.role ? ` — ${p.role}` : ''}`)
    }
    console.log('\nValues are never printed. Rotate to issue a new one.')
    return
  }

  const name = args.find((a) => !a.startsWith('--'))
  if (!name) {
    console.error('Give a name: npx tsx scripts/say-token.ts "Brandon"')
    process.exit(1)
  }

  const person = await db.person.findFirst({
    where: { name: { equals: name, mode: 'insensitive' }, active: true },
    select: { id: true, name: true, sayToken: true },
  })
  if (!person) {
    const all = await db.person.findMany({ where: { active: true }, select: { name: true } })
    console.error(`No active person called "${name}". There is: ${all.map((p) => p.name).join(', ')}`)
    process.exit(1)
  }

  if (args.includes('--revoke')) {
    await db.person.update({ where: { id: person.id }, data: { sayToken: null } })
    console.log(`Revoked. ${person.name}'s saved link and shortcut will stop working immediately.`)
    return
  }

  const token = mintSayToken()
  await db.person.update({ where: { id: person.id }, data: { sayToken: token } })

  const rotated = person.sayToken ? ' (the previous one stopped working just now)' : ''
  console.log(`\n${person.name} is set up${rotated}.\n`)
  console.log('───────────────────────────────────────────────────────────────')
  console.log('SEND THEM THIS LINK. It carries the secret, so send it the way')
  console.log('you would send a password, and only to them.\n')
  console.log(`  ${base}/say?k=${token}\n`)
  console.log('Opening it once saves it to their phone; the address bar clears')
  console.log('itself afterwards. Then: Share → Add to Home Screen.')
  console.log('───────────────────────────────────────────────────────────────')
  console.log('\nFor the Siri shortcut, the same secret goes in a header:\n')
  console.log(`  POST ${base}/api/say?format=text`)
  console.log(`  Authorization: Bearer ${token}`)
  console.log('  Body: the dictated text, as plain text\n')
  console.log('This is the only time either is shown. Nothing can read it back.')
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  })
