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
