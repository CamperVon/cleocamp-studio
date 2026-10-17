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
  {
    on: '2026-10-14',
    text: 'Email: when you only cc Mouse on an email to someone else, like a reply to a vendor, Mouse stays quiet. It writes back only if your own words ask it something by name ("Mouse, how many yards do we have?"). What it learns from the thread still lands in the app for a tap, as before.',
  },
  {
    on: '2026-10-15',
    text: 'Email: when you email Mouse and ask it to tell someone on the team something ("let Cleo know the charge is $69.59"), it now emails them itself. It can only write to the team this way. Email to a vendor or customer still goes through the app chat, where you see the draft first.',
  },
  {
    on: '2026-10-15', path: '/files',
    text: 'Files: Mouse can now delete a kept file when you ask in the chat ("delete the old W-9"). If more than one file could be the one you mean, it asks which before deleting anything.',
  },
  {
    on: '2026-10-15', path: '/files',
    text: 'Mouse can now attach anything kept in Files to an email ("send Kaylinn our W-9"). The draft names the attachment, and nothing goes until you say send.',
  },
  {
    on: '2026-10-16', path: '/connector',
    text: 'Claude (claude.ai) can now read Studio Mouse directly: products, live Shopify stock, prices, POs, vendors, open questions, notes and the daily brief. It can\'t change anything. To connect it, add a custom connector in Claude with https://admin.cleocamp.com/api/mcp and tap Allow. The new Claude Connector page (under More) shows what is connected, every look-up, a Disconnect button, and a switch that lets Muse read products, stock, prices, POs and vendors too.',
  },
  {
    on: '2026-10-16', path: '/connector',
    text: 'In a Claude chat you can now say "tell Mouse …" and Claude passes it straight to Mouse, which acts on it as if you had typed it; or "tell Claude Code …" for an idea about how the app should work. Everything Claude told Mouse, with Mouse\'s reply, is on the Claude Connector page.',
  },
  {
    on: '2026-10-16',
    text: 'You can now ask Mouse by email to draft a wholesale or live-sale invoice. It drafts it in Shopify and replies with the link; sending it to the customer is still done in the app chat.',
  },
  {
    on: '2026-10-16', path: '/style-numbers',
    text: 'Style numbers are now three letters and three digits: the Cleo Tee is TCO101, so a SKU reads TCO101-BLK-01. Old numbers like TP101 still find the product. Products page, "How style numbers work" explains it all, with the full list of styles.',
  },
  {
    on: '2026-10-16', path: '/purchase-orders',
    text: 'Purchase orders now say which pattern each piece is cut from, like "Pattern: TCO101-P2" under the Cleo Tee line. A style with one pattern fills it in by itself; a Cleo Tee order waits until you tell Mouse P1 (pre-washed fabric) or P2 (PFD). Patterns never touch SKUs or Shopify.',
  },
  {
    on: '2026-10-16',
    text: 'Fewer doubled-up todos. The Daily Cheese now says each thing once (the Antonio\'s pickup was coming as a todo, a calendar entry and PO 2360 all at once), Mouse will not add a todo or question that is already open, and any copies already there show up on Home each morning for a one-tap close.',
  },
  {
    on: '2026-10-16',
    text: 'Mouse can now draft a wholesale invoice as a deposit: say "half now, the rest on delivery" and the invoice keeps the full order, adds a line like "50% deposit. Balance of $3,530 due on delivery." and asks for what is due now. Shopify works out every figure, and a revision keeps the deposit, or a discount you added in Shopify, instead of wiping it.',
  },
  {
    on: '2026-10-16', path: '/components',
    text: 'Mouse can now switch a leather from skins to square feet once stock is counted. Tell it how many sq ft a skin was (from the invoice) and it restates the stock, the recipes and the price together.',
  },
  {
    on: '2026-10-16',
    text: 'Mouse can now email Lorena (and any vendor) at the address on their record. It was refusing her address as "not on file".',
  },
  {
    on: '2026-10-16', path: '/components',
    text: 'You can tell Mouse a component goes into no product on purpose, like the gold safety pins and the brass rivets. They stay counted and stop showing up as "on no product" each morning.',
  },
  {
    on: '2026-10-17',
    text: 'The LOG codes are gone. Tell Mouse a delivery came in ("log the whites", or send the packing slip) and it logs it, the way it did before. If something does not add up it asks you in plain words.',
  },
  {
    on: '2026-10-16', path: '/products',
    text: 'Files can now hold a link as well as a file. The Google Drive folders for the Cleo Tee, Cosmo Stripe Tee and Story Dress (tech packs and pattern files) show under each product; tap to open. Ask Mouse "where are the Story Dress files?" and it gives you the link, or paste a link on the Files page.',
  },
  {
    on: '2026-10-16',
    text: 'Mouse can now email a customer or a wholesale store at the address on their record, like asking order #2835 for a phone number for DHL. It still shows you the email in the chat and sends only when you say so.',
  },
]

/** The updates no earlier edition carried, oldest first. `earlier` is the text of past editions. Pure. */
export function unannounced(updates: Update[], earlier: string[]): Update[] {
  return updates.filter((u) => !earlier.some((body) => body.includes(u.text)))
}
