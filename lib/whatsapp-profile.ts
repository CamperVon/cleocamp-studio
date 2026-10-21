import { db } from '@/lib/db'
import { normalizePhone } from '@/lib/whatsapp'

/**
 * Mouse's face as the WhatsApp number's profile photo (Brandon, 21 Oct 2026:
 * "Use mouse face here for profile"). Set once, by the app itself, because the
 * Telnyx key lives only in Vercel. The ShadowRun row is the lock: one upload,
 * ever, for this key. To change the photo, replace the image and bump the key.
 */
export const PROFILE_PHOTO_KEY = 'whatsapp-profile-photo-v1'
const IMAGE_URL = 'https://admin.cleocamp.com/mouse/whatsapp-profile.jpg'

let settled = false

export async function setWhatsAppPhotoOnce(): Promise<void> {
  if (settled) return
  const key = process.env.TELNYX_API_KEY?.trim()
  const number = normalizePhone(process.env.WHATSAPP_FROM ?? '+12136190002')
  if (!key || !number || process.env.VERCEL_ENV !== 'production') return
  settled = true
  const claimed = await db.shadowRun.createMany({ data: [{ key: PROFILE_PHOTO_KEY, status: 'RUNNING', codeVersion: process.env.VERCEL_GIT_COMMIT_SHA ?? null }], skipDuplicates: true })
  if (claimed.count !== 1) return
  let error: string | null = null
  try {
    const img = await fetch(IMAGE_URL)
    if (!img.ok) throw new Error(`image ${img.status}`)
    const form = new FormData()
    form.append('file', new Blob([await img.arrayBuffer()], { type: 'image/jpeg' }), 'mouse.jpg')
    const res = await fetch(`https://api.telnyx.com/v2/whatsapp/phone_numbers/${encodeURIComponent(number)}/profile/photo`, {
      method: 'POST', headers: { authorization: `Bearer ${key}` }, body: form,
    })
    if (!res.ok) error = `Telnyx ${res.status}: ${(await res.text()).slice(0, 300)}`
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }
  await db.shadowRun.update({ where: { key: PROFILE_PHOTO_KEY }, data: { status: error ? 'FAILED' : 'PASSED', finishedAt: new Date(), error } })
  if (error) {
    const { logIssues } = await import('@/lib/mouse/issues')
    await logIssues('whatsapp', null, [{ kind: 'TOOL_FAILED', tool: 'whatsapp-profile-photo', detail: `Setting the WhatsApp profile photo failed: ${error}` }])
  }
}
