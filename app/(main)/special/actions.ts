'use server'
import { db } from '@/lib/db'
import { previewNotice, sendNoticeChunk, sendNoticeTest, type Match } from '@/lib/waiting-notice'

export type NoticeInput = { product: string; colours: string; subject: string; message: string }

/** Only a signed-in team member may email customers (CLAUDE.md §4: a person's tap). */
async function teamMember() {
  const { currentPersonId } = await import('@/lib/session')
  const id = await currentPersonId()
  return id ? db.person.findFirst({ where: { id, active: true, external: false }, select: { id: true, name: true, email: true } }) : null
}

function read(i: NoticeInput): { m: Match; subject: string; message: string } | string {
  const product = i.product.trim()
  const colours = i.colours.split(',').map((c) => c.trim()).filter(Boolean)
  const subject = i.subject.trim()
  const message = i.message.trim()
  if (!product) return 'Which product?'
  if (!colours.length) return 'Which colours?'
  if (!subject) return 'The email needs a subject.'
  if (!message) return 'The email needs a message.'
  return { m: { product, colours }, subject, message }
}

export async function previewWaiting(i: NoticeInput) {
  if (!(await teamMember())) return { error: 'Sign in with your own link to do this.' }
  const r = read(i)
  if (typeof r === 'string') return { error: r }
  try {
    return { preview: await previewNotice(r.m, r.subject, r.message) }
  } catch (e) {
    return { error: `Shopify could not be read: ${(e as Error).message}` }
  }
}

export async function testWaiting(i: NoticeInput) {
  const me = await teamMember()
  if (!me) return { error: 'Sign in with your own link to do this.' }
  if (!me.email) return { error: 'There is no email on file for you to send the test to.' }
  const r = read(i)
  if (typeof r === 'string') return { error: r }
  const res = await sendNoticeTest(r.m, r.subject, r.message, me.email)
  return res.sent ? { ok: `Test sent to ${me.email}.` } : { error: `The test did not send: ${res.reason}` }
}

export async function sendWaitingChunk(i: NoticeInput) {
  const me = await teamMember()
  if (!me) return { error: 'Sign in with your own link to do this.' }
  const r = read(i)
  if (typeof r === 'string') return { error: r }
  try {
    return { chunk: await sendNoticeChunk(r.m, r.subject, r.message, me.id) }
  } catch (e) {
    return { error: `Sending stopped: ${(e as Error).message}. Tap send again to carry on; nobody gets it twice.` }
  }
}
