'use server'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { currentPersonId } from '@/lib/session'

const STATUSES = ['OPEN', 'WAITING_ON_CUSTOMER', 'WAITING_ON_RETURN', 'RESOLVED'] as const
type Status = (typeof STATUSES)[number]

/** Moving a case along. Only a signed-in person does this — never an email. */
export async function setCaseStatus(id: string, status: Status) {
  if (!STATUSES.includes(status)) return
  await db.supportCase.update({
    where: { id },
    data: { status, resolvedAt: status === 'RESOLVED' ? new Date() : null },
  })
  revalidatePath('/support')
  revalidatePath('/')
}

/** A note on the case for the team — what was done off-app, a phone call. Never sent. */
export async function addCaseNote(id: string, text: string) {
  if (!text.trim()) return
  const who = await currentPersonId()
  const person = who ? await db.person.findUnique({ where: { id: who }, select: { name: true } }) : null
  await db.supportMessage.create({
    data: { caseId: id, direction: 'NOTE', fromAddress: person?.name ?? null, body: text.trim() },
  })
  revalidatePath('/support')
}
