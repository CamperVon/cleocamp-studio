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
  {
    on: '2026-10-12', path: '/purchase-orders',
    text: 'Purchase orders now show a photo for colours that are not on Shopify, like the Cannellini and Espresso Bean Bags. Send Mouse a photo in chat and say which colour it is.',
  },
  {
    on: '2026-10-12', path: '/components',
    text: 'Components page: fabric bought by the metre but measured in yards now shows both prices, metre first, like the 5to7 Skirt shell: $12.24/metre, $11.19/yard.',
  },
  {
    on: '2026-10-13', path: '/components',
    text: 'Thermal shipping labels now come off studio stock by themselves, two per package shipped (Jane uses two a package), in the same nightly count as mailers and postcards. Jane\'s count of 80 is where it starts.',
  },
  {
    on: '2026-10-13', path: '/components',
    text: 'Orders written in packs, like "2 packs of 2,000" on PO 2407, now count as what is inside: 4,000 thermal labels show as on the way, and logging the delivery ticks the order off.',
  },
  {
    on: '2026-10-13', path: '/components',
    text: 'Shipping supplies now run down at their true pace in the forecast. Recently counted supplies were reading far too slow: mailers now show about 9 weeks left instead of 14, so reorders get flagged sooner. Labels join them after their first night.',
  },
  {
    on: '2026-10-13',
    text: 'When Mouse runs out of steps on a long request, it now tells you what it did and what is left, instead of "I reached this turn\'s reasoning limit… please continue from here", which made finished work look like a failure.',
  },
  {
    on: '2026-10-13',
    text: 'Purchase orders: when you ask Mouse to reword a product line (say "Boy Belt / Small (90)"), that wording now prints on the PO. Before, it said it had changed it but the PO kept the plain name.',
  },
  {
    on: '2026-10-13', path: '/wholesale',
    text: 'Wholesale invoices can now include colours that are only in the app, like the Red, Cannellini and Espresso Petite Bean Bags. They go on the Shopify invoice as their own line, and the rest of the order still comes off stock as usual.',
  },
  {
    on: '2026-10-13',
    text: 'Ask Mouse what is still waiting to ship, like "which Story Dress orders haven\'t shipped?" or "how many Black size 1s are we waiting to send?". It answers from Shopify with the order numbers and how long the oldest has been waiting.',
  },
  {
    on: '2026-10-14', path: '/support',
    text: 'Support: fewer Pressing emails. A customer\'s second email now sends one only when it still asks for something (a question, or "I haven\'t heard back"), not when it just confirms or updates you, like "I sent all three back." Changes to an order that hasn\'t shipped still email right away. If the second email only says the problem sorted itself out ("the tracking just updated!"), the case closes itself with a note, and you can reopen it.',
  },
]

/** The updates no earlier edition carried, oldest first. `earlier` is the text of past editions. Pure. */
export function unannounced(updates: Update[], earlier: string[]): Update[] {
  return updates.filter((u) => !earlier.some((body) => body.includes(u.text)))
}
