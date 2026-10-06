'use server'

import { searchEverything, type SearchHit } from '@/lib/search'

/** The search box's look-up. Read-only; signed-in only, like every page (proxy.ts). */
export async function search(query: string): Promise<SearchHit[]> {
  return searchEverything(String(query ?? '')).catch((e) => {
    console.error('[search]', e)
    return []
  })
}
