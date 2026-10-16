'use server'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { revokeClient } from '@/lib/mcp/oauth'

/** Disconnect: every token the app holds stops working at once. Claude has to be connected again to read anything. */
export async function disconnect(formData: FormData) {
  const id = String(formData.get('clientId') ?? '')
  if (id) await revokeClient(db, id)
  revalidatePath('/connector')
}

/** Muse may read through the connector with its own key while this switch is on (lib/mcp/server.ts). */
export async function setMuse(formData: FormData) {
  const on = formData.get('on') === '1'
  if (on) await db.mcpClient.upsert({ where: { id: 'muse' }, create: { id: 'muse', name: 'Muse', redirectUris: [], tokenEndpointAuthMethod: 'muse-key' }, update: {} })
  else await db.mcpClient.deleteMany({ where: { id: 'muse' } })
  revalidatePath('/connector')
}
