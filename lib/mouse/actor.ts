/**
 * Who a chat turn is for, so what Mouse writes carries their name. The tools
 * are called with their input only; this is how a stock entry knows it was
 * Jane's and not Brandon's, and how a second person logging the same pickup
 * can be told who got there first. Null when nobody says (the shared
 * password, the nightly pass).
 */
import { AsyncLocalStorage } from 'node:async_hooks'

const store = new AsyncLocalStorage<string | null>()

export function asPerson<T>(personId: string | null, fn: () => Promise<T>): Promise<T> {
  return store.run(personId, fn)
}

export function currentActor(): string | null {
  return store.getStore() ?? null
}
