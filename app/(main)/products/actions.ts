'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'

/**
 * How SKUs read while the style system rolls out (8 Oct 2026): "transition"
 * shows TP101-WHT-01 (was CCSS25COT-WHT01), "new" the new SKU only. Sent
 * purchase orders are not affected: they keep what they were sent with.
 */
export async function setSkuDisplayMode(mode: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (mode !== 'transition' && mode !== 'new') return { ok: false, error: 'Transition or new.' }
  await db.documentDefaults.update({ where: { id: 'singleton' }, data: { skuDisplayMode: mode } })
  for (const p of ['/products', '/purchase-orders']) revalidatePath(p)
  return { ok: true }
}
