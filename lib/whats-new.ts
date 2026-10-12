/**
 * What changed in the app that the team will see, in their words (Brandon,
 * 8 Oct 2026: "alert the team of this (and all new updates continually) in
 * the daily cheese"). Whoever ships something the team will notice adds a
 * line here in the same commit (CLAUDE.md). The Daily Cheese carries every
 * line no earlier edition has, so each is announced once, on the first
 * morning after it is live, however long a review took. Fixed text, never
 * written by a model. Pure: no imports.
 */
export type Update = { on: string; text: string; path?: string }

export const WHATS_NEW: Update[] = [
  {
    on: '2026-10-09', path: '/stylists',
    text: 'Stylists page: the stylist inventory now sits second, under Requests, as "ready to pull", with every piece named on the closed line and a photo of each.',
  },
  {
    on: '2026-10-09',
    text: 'Anything new on Shopify now comes into the app by itself overnight: a new size or colour joins its product, and a new colour listing joins its style (as the Black and White Boy Belts do). If it looks like something already here, Mouse asks once instead of guessing. The Daily Cheese lists what came in.',
  },
  {
    on: '2026-10-09', path: '/components',
    text: 'Components page: a box at the top to tell Mouse something, the same as on Products.',
  },
  {
    on: '2026-10-12',
    text: 'Mouse can now change a colour\'s code after SKUs are made (like RST to CST on the Cosmo Tee) and rebuild the SKUs, and it tells you which ones the Shopify listing still needs changed to match.',
  },
  {
    on: '2026-10-12',
    text: 'Mouse can now add an email to a Shopify order made without one, like a gift, so the person gets their shipping emails. Ask in chat, or email Mouse yourself.',
  },
  {
    on: '2026-10-12', path: '/support',
    text: 'Support now finds a customer\'s order by their name, or by another email they mention, when they write from a different address. Tracy Dong\'s #2725 is the one it missed.',
  },
  {
    on: '2026-10-12',
    text: 'Mouse can now set up a wholesale-only colour on a product that is also on Shopify, like the Cannellini and Espresso Petite Bean Bags, with its own SKU.',
  },
  {
    on: '2026-10-12', path: '/',
    text: 'Your chat with Mouse now follows you: start it on your phone and it is there on your computer, and the other way round. It starts with your next message.',
  },
]

/** The updates no earlier edition carried, oldest first. `earlier` is the text of past editions. Pure. */
export function unannounced(updates: Update[], earlier: string[]): Update[] {
  return updates.filter((u) => !earlier.some((body) => body.includes(u.text)))
}
