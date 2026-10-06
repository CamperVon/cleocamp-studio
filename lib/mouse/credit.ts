import { db } from '@/lib/db'

import { OUT_OF_CREDIT_LOG } from '@/lib/mouse/credit-text'
export { isOutOfCredit, OUT_OF_CREDIT_TEXT, OUT_OF_CREDIT_LOG } from '@/lib/mouse/credit-text'

/**
 * Email Brandon, once per outage: not if the log has seen it in the last 12
 * hours (a busy morning of failed chats is one email, not twenty). Call it
 * BEFORE the failure is logged, so the check sees only earlier ones. Never
 * throws: a warning that cannot be sent must not take anything else down.
 */
export async function warnOutOfCredit(where: string): Promise<void> {
  try {
    const recent = await db.mouseIssue.findFirst({
      where: { detail: OUT_OF_CREDIT_LOG, lastSeenAt: { gte: new Date(Date.now() - 12 * 3600e3) } },
      select: { id: true },
    })
    if (recent) return
    const b = await db.person.findUnique({ where: { id: 'per_brandon' }, select: { email: true } })
    if (!b?.email) return
    const { sendEmail } = await import('@/lib/email')
    await sendEmail({
      to: [b.email],
      subject: 'Studio Mouse is out of Anthropic credit',
      text:
        `Mouse just failed to run (${where}) because the Anthropic account it runs on is out of credit.\n\n` +
        'Until it is topped up, the chat, the nightly email pass, support reply drafts and the morning notes all stop.\n\n' +
        'Top it up at console.anthropic.com, under Plans & Billing. Turning on auto-reload there stops this happening again.\n\n' +
        '— Studio Mouse',
    })
  } catch (e) {
    console.error('[credit] could not warn', e)
  }
}
