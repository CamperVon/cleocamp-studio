# Mouse: code changes since 3 October 2026

On 3 October 2026 the code was copied (at commit `aa300cc`) to start the general Mouse product. This file lists the changes made here since then that would help any business, so they can be carried across to that copy by hand.

It holds code changes only: no customer, order or stock data, and nothing that only makes sense for this one brand. Each entry says what changed, what problem it solves, the commits and files, and whether it needs Shopify or email.

---

## How Mouse thinks and remembers

### Mouse can search the whole chat · `fa647db`
- **Problem:** Mouse only saw the last 20 messages of the current conversation. When it was asked about something said earlier, it couldn't find it and asked again.
- **Change:** a `search_chat` tool searches every chat message by its words, over any number of days, and returns the newest matches with who said them. Look-up tools no longer count as changes in the activity record.
- **Files:** `lib/mouse/tools.ts`, `lib/mouse/outcomes.ts`, `lib/mouse/agent.ts`, `lib/mouse/prompt.ts`

### Mouse can read the emails it sent · `68bfe2b`
- **Problem:** Mouse could see only the subject lines of its sent mail. Asked what it had told someone, it guessed or said it couldn't know.
- **Change:** `check_sent_mail` returns the full text of the newest five matches and can filter by subject.
- **Files:** `lib/mouse/tools.ts`

### Mouse remembers what it made · `240c4da`
- **Problem:** after each reply Mouse keeps a one-line record of what it did, but that record dropped the ids of anything it created. It could make a customer account and then fail to use it in the very next message.
- **Change:** that record now carries the name and id of whatever a tool made or found (`madeRefs` in `lib/mouse/agent.ts`).
- **Files:** `lib/mouse/agent.ts`, `tests/memory-refs.test.ts`

### Mouse finds records by name · `240c4da`
- **Problem:** some tools accepted only an internal id, and Mouse's context listed only accounts that already had activity, so a newly made account was invisible to it.
- **Change:**
  - Mouse's context lists every account with its id, and says when an email or address is missing.
  - The account tools take a name, matched the same way everywhere (`pickNamed` in `lib/stylists.ts`). A given id must match the name, and more than one match makes Mouse ask instead of picking.
- **Files:** `lib/mouse/tools.ts`, `lib/mouse/context.ts`, `lib/stylists.ts`

### A troubleshooting log · `e3733d2`
- **Problem:** when a tool failed or refused, or a turn stopped short, the only trace was whatever Mouse chose to say in its reply. Problems it glossed over were invisible to whoever maintains the code.
- **Change:**
  - After every run, code writes each failed or refused tool call and each unfinished turn to a `MouseIssue` table, with the tool, the error and the input. Repeats of the same failure count up on one row.
  - Mouse can add its own entry with `note_problem` (a tool that did something unexpected, data that contradicts itself). It emails nobody, and it doesn't count as having recorded something.
  - `scripts/troubleshooting.ts` prints the open log, the open "couldn't do" flags and support cases flagged as wrong, and marks entries fixed. The project instructions say to read it at the start of every session.
- **Files:** `lib/mouse/issues.ts`, `lib/mouse/agent.ts`, `lib/mouse/tools.ts`, `lib/mouse/outcomes.ts`, `lib/mouse/prompt.ts`, `scripts/troubleshooting.ts`, `prisma/schema.prisma` (`MouseIssue`), `tests/mouse-issues.test.ts`

### Says plainly when the AI account is out of credit · `5628346`
- **Problem:** when the Anthropic account ran out of credit, every chat answered only "The model connection failed", which reads as a glitch to retry, not a bill to pay. Support drafts said only that Mouse couldn't write one.
- **Change:** a credit refusal is recognised. The chat says Mouse is out of credit and where to top it up. Support drafts leave a note that says the same. The troubleshooting log gets one plain line, and the owner gets one email per outage (none if the log saw it in the last 12 hours).
- **Needs:** email, for the warning.
- **Files:** `lib/mouse/credit-text.ts`, `lib/mouse/credit.ts`, `lib/mouse/runner.ts`, `lib/mouse/agent.ts`, `lib/mouse/issues.ts`, `lib/support/draft.ts`, `lib/support/pass.ts`, `tests/runner.test.ts`, `tests/mouse-issues.test.ts`

### Catalogue split into stable and live cache blocks · `11c6832`
- **Problem:** the whole catalogue sat behind one five-minute cache mark, so it was written to the cache again on nearly every chat turn. Cache writes were most of the chat bill.
- **Change:**
  - The catalogue is built exactly as before, then cut at its "## " headings. Sections that rarely change (places, vendors, wholesale stores, people, printed-document defaults) go in a block with a one-hour cache mark. Everything else, including notes, the date, stock, orders and to-dos, goes in the five-minute block. No section is reworded, shortened or dropped.
  - If a stable heading appears twice (a note line that looks like a heading), everything goes in the live block.
  - Each run records, alongside its token usage, the size and a short hash of each block and each section: sizes only, no text.
- **Files:** `lib/mouse/context.ts` (`splitCatalog`, `buildCatalogParts`, `catalogStats`), `lib/mouse/cache-blocks.ts`, `lib/mouse/agent.ts`, `lib/mouse/runner.ts`, `tests/catalog-split.test.ts`

### Recipe lines for one colour of a product · `HASH`
- **Problem:** a bill-of-materials line could be limited to one size but not one colour, so a lining used only in the black version either charged every colour for it or had its quantity left blank.
- **Change:** `BomLine.colorway` (nullable; with `size` it means that colour in that size). The forecast counts the line against only the matching variants' sales, the component kickoff after a PO goes out counts only the matching variants ordered, and the recipe tool refuses a colour the product does not have and stores the product's own spelling. Shown as "(Black only)" on the Products page and in the assistant's context.
- **Files:** `lib/bom.ts` (`lineFits`, `lineScopeLabel`, `matchColorway`), `lib/forecast.ts`, `lib/mouse/component-kickoff.ts`, `lib/mouse/tools.ts` (`update_product_bom`, PO kickoff caller), `lib/mouse/context.ts`, `app/(main)/products/page.tsx`, `prisma/schema.prisma`, migration `20261006230000_bom_line_colorway`, `tests/bom-scope.test.ts`
- **Needs:** a database migration (additive column).

### Search box that opens the page at the closest hit · `8891d13`
- **Problem:** finding one vendor, component, PO or person meant knowing which page it lived on and unfolding lists by hand.
- **Change:** a search button in the top bar (beside More on desktop, top right on a phone). As you type it lists the closest records across products, components, vendors, POs, wholesale accounts, stylists, contacts, customers, open support cases and open to-dos, ranked exact name, then starts-with, then a word, then anywhere, then a near miss of a letter or two (never for numbers, so 2390 is not offered for PO 2391). Enter goes to the first. No model involved. The page opens at that row: rows carry `data-rec`, and a small client helper unfolds the `<details>` and button-toggled sections around it, scrolls to it and highlights it. Folded cards now keep their rows in the page, hidden, so they can be found.
- **Files:** `lib/search.ts`, `app/(main)/search-actions.ts`, `app/ui/search.tsx`, `app/ui/jump.tsx`, `app/ui/nav-bar.tsx`, `app/(main)/layout.tsx`, `app/ui/collapsible-card.tsx`, `app/ui/product-section.tsx`, the list pages and row components (`data-rec`), `app/globals.css`, `tests/search.test.ts`
- **Needs:** nothing external.

### Support drafts know the stock of what the customer ordered · `53840ca`
- **Problem:** an exchange for another size of something already delivered got no stock facts. Stock facts only covered unshipped items, and catalogue facts only covered products the customer named, so "can I get the new size?" left the drafter asking the team to confirm stock.
- **Change:** catalogue facts are now looked up from the subject, the customer's latest words and the products on their order (shipped or not), unless the order is not theirs. The drafting policy says to answer stock for an exchange from those facts (never a count) and leaves only the ship-before-return decision to a person.
- **Files:** `lib/support/draft.ts` (`catalogText`), `lib/support/reply.ts`, `tests/support-reply.test.ts`
- **Needs:** Shopify (live variant stock) and the support inbox.

### Notes as an index in chat, full notes on demand · `41322f6`
- **Problem:** every chat turn carried every current note in full (about 14,500 tokens), mostly about records the turn had nothing to do with.
- **Change:**
  - Chat's catalogue lists notes by subject: how many are current, when the newest was written, and how many were written before the latest count. Notes with no subject stay in full. Background runs keep the full notes, unchanged.
  - A read-only `open_record` tool returns one record (product, component, vendor, PO, production run, wholesale account, or a note subject) with every current note in full, the stale-count warning included. It finds a record only by exact id, PO number or exact full name; a name more than one record shares comes back as the candidates.
  - When a chat message names a record exactly (a PO number, an id, or a full name of four characters or more, longest name winning), code looks up its notes first and sends them as a separate block after the person's words, whole records only, within a size limit. Shared names are reported, not chosen between. Everyday words that are also free-text note subjects preload nothing.
  - The notes returned after a write were cut to 200 characters each; they now come whole within a size limit, with any more listed by id.
- **Files:** `lib/mouse/notes.ts`, `lib/mouse/records.ts`, `lib/mouse/context.ts`, `lib/mouse/agent.ts` (`turnContent`, `chatTurn`), `lib/mouse/tools.ts` (`open_record`), `lib/mouse/outcomes.ts`, `lib/mouse/stale-notes.ts`, `lib/mouse/prompt.ts`, `tests/notes-index.test.ts`

### Mouse asks instead of guessing quantities · `fa647db`
- **Problem:** asked to add one item to an order, Mouse misread the request and changed quantities nobody had mentioned.
- **Change:** the prompt rule on asking versus acting was tightened. A quantity nobody stated is a question, never a guess. A purchase order prints its "For" line only when the order is for a single product.
- **Files:** `lib/mouse/prompt.ts`, `lib/po-pdf.tsx`, `tests/po-for-line.test.ts`

### Plain text in chat, and tables drawn properly · `148f891`
- **Problem:** the chat window shows only bold text and links, so a markdown table Mouse wrote arrived as rows of pipes and dashes.
- **Change:**
  - The prompt says no tables, headings or asterisk bullets in chat. Counts by colour and size go one colour per line, total first: "Red, 30: XS 13, S 7, M 8, L 2."
  - Any table that still appears, including in old replies, is drawn as a real table that scrolls sideways on a phone.
- **Files:** `lib/mouse/prompt.ts`, `app/ui/chat.tsx`, `app/ui/page-chat.tsx`, `tests/render-mouse.test.ts`

---

## Talking to Mouse

### A "Tell Mouse" box on any page · `38ab457`
- **Problem:** people wanted to leave a thought or note while looking at a page, without going to the main chat.
- **Change:**
  - A one-line box (`PageChat`) can go at the top of any page. It talks to the same Mouse, which is told which page the note came from and says in one line what it did with it.
  - Each page keeps its own short conversation in that browser.
  - Notes on records with a single notes field are now added as a dated line (`addToNotes`) instead of replacing what's there. Mouse is never shown the existing notes, so replacing them would wipe them.
- **Files:** `app/ui/page-chat.tsx`, `app/api/chat/route.ts`, `lib/append-note.ts`, `lib/mouse/tools.ts`, `lib/mouse/prompt.ts`, `tests/append-note.test.ts`

### Mouse reads invoices and receipts sent by email · `5958cdb`
- **Problem:** Mouse could read a PDF or photo attached in the chat, but not one attached to an email.
- **Change:**
  - On email from a team member, Mouse fetches attached PDFs and photos (JPG, PNG, WEBP) and reads them like chat files. Limits: three files, each under 4MB, and anything skipped is named.
  - Attachments from anyone outside the team are never fetched.
  - Rule: an attached invoice or receipt is information. Mouse records what the sender's own words ask for (paid, received, a record-only order, the prices) and checks the file against the order it belongs to.
- **Needs:** email (Resend inbound).
- **Files:** `lib/inbound-body.ts`, `lib/mouse/nightly-pass.ts`, `tests/inbound-files.test.ts`

### Dismiss button on items filed for the developer · `54fb760`
- **Change:** items Mouse files for whoever maintains the code can be dismissed from the ToDo page.
- **Files:** `app/(main)/items/`

---

## Selling and customers

### Message everyone waiting on a product · `0cbc580`, `b8bc779`, `5cd4ebb`, `7e10c59`, `2439eb0`, `67b9439`
- **Problem:** a brand needed to email every customer whose order was still waiting on one product (a pre-order running late). Shopify Email only reaches customers who signed up for marketing.
- **Change:**
  - A page (here a "Special" tab for one-off sends) finds every open order still waiting on chosen products and colours. Shopify is only read: no tags, no order edits.
  - A test send goes to yourself first, then the real send goes out in small batches. Each send is recorded per order, so a second tap or a resumed send never emails anyone twice. Failed sends are retried.
  - Each customer is greeted by a name that is really theirs. Code checks the first names on the account, card and parcel against the email address: the name in the email address wins, then a name they all agree on, then card and parcel agreeing. Initials are dropped, and names typed in all capitals or all lower case are fixed. If nothing settles it, the email says "Hi there".
- **Needs:** Shopify (orders, read-only), email (Resend).
- **Files:** `lib/waiting-notice.ts`, `app/(main)/special/`, `app/ui/waiting-notice.tsx`, `prisma/schema.prisma` (`CustomerNotice`), `tests/waiting-notice.test.ts`

### Pictures in a one-off email · `7e22b93`
- **Change:** a one-off email can carry pictures below the words, such as a signature or a collage, attached inline so mail apps show them. They come from a fixed list of files, and a missing file stops the send before anyone is emailed.
- **Needs:** email.
- **Files:** `lib/notice-pictures.ts`, `lib/waiting-notice.ts`, `lib/email.ts` (`contentId` on attachments), `next.config.ts`

### The main domain is only used when a person chooses it · `993ff07`
- **Problem:** a one-off customer email had to come from the brand's main address, but automated mail should stay on a separate sending subdomain, which keeps its reputation apart from the team's own email.
- **Change:** `sendEmail` refuses any From address on the main domain unless a person ticked it for that send.
- **Needs:** email.
- **Files:** `lib/email.ts`, `lib/waiting-notice.ts`

### A discount code is never offered twice to the same customer · `a606ebd`
- **Problem:** the support reply drafter saw only the current conversation, so it offered a once-per-customer code again to customers who already had it.
- **Change:** before drafting, code looks up whether the customer was offered the code in any earlier reply, or used it in Shopify, and tells the drafter. A draft that offers it anyway is flagged on the reply card.
- **Needs:** Shopify (order search), the support inbox.
- **Files:** `lib/support/draft.ts`, `lib/support/reply.ts`, `tests/support-reply.test.ts`

### A size or colour swap is made in Shopify before the reply says so · `b719ad5`
- **Problem:** a customer asked to swap an unshipped item to another size, the team said yes, and the drafted reply promised it. The only button under it changed the address and sent the reply. The order still had the old size.
- **Change:**
  - The reply drafter names the swap (item, from, to). Code finds exactly one unshipped line and the wanted variant of the same product, and stores it with any problems.
  - One tap does the swap with a Shopify order edit (new variant added, old one restocked), changes the address too if the draft has one, then sends. If the swap would change the order's subtotal (a different price, or a discount on the old item), nothing is committed and the person is told to do it in Shopify.
  - Every send path refuses a reply that says an item changes to a size or colour the order doesn't show, while something is still waiting to ship.
- **Needs:** Shopify (`write_order_edits`), the support inbox.
- **Files:** `lib/support/reply.ts`, `lib/support/orders.ts`, `lib/support/draft.ts`, `app/(main)/support/`, `app/ui/support-case.tsx`, `prisma/schema.prisma` (`SupportCase.draftSwap`), `tests/support-swap.test.ts`

---

## Stock and orders

### Orders placed in packs or rolls are counted in single units · `3db36c4`
- **Problem:** a PO ordered stickers by the roll ("6 roll (500/roll)") while stock counts single stickers. Every figure that read the order took 6 rolls as 6 stickers: the forecast said 6 on order and short, and when 3,000 stickers arrived the receipt was refused as more than the order owed.
- **Change:** a PO line's quantity is converted to the component's counting unit, using the pack size the line states ("500/roll") or the component's own purchase unit and units per purchase unit. What a PO still owes, receipts, reversals and the incoming figure the forecast uses all go through it. A line with no conversion is read as it is, as before.
- **Files:** `lib/po-units.ts`, `lib/po-receipts.ts`, `lib/forecast.ts`, `tests/po-units.test.ts`

### Recipe lines for one size only · `3db36c4`
- **Problem:** a component used only by one size of a product (a size 2 label on size 2 garments) could only be recorded for the whole product, so stock and the forecast could not tell sizes apart.
- **Change:** a recipe line can carry a size. The forecast works out that line's usage from that size's sales only. Mouse can set it, and sees "(size 2 only)" in its context.
- **Files:** `prisma/schema.prisma` (`BomLine.size`), `lib/forecast.ts`, `lib/mouse/tools.ts` (`update_product_bom`), `lib/mouse/context.ts`

---

## Wholesale

### Wholesale invoice with sales tax, only when asked · `bf39bac`, `240c4da`
- **Change:**
  - Wholesale invoices are tax-free by default. Saying "with sales tax" makes Shopify work out tax for the store's address, and a draft with tax and no address on file is refused up front.
  - A charge named on a handed-over order goes on as "Delivery".
  - Every draft now states its tax setting explicitly, because Shopify keeps a revised draft's old setting when the field is left out.
- **Needs:** Shopify (draft orders).
- **Files:** `lib/mouse/tools.ts`, `lib/mouse/prompt.ts`, `lib/live-sale.ts`

### Line sheet words: add, don't overwrite · `e3733d2`
- **Problem:** told to add shipping terms to the line sheet, Mouse set the footnote to them, and the footnote that was there disappeared. It had never been shown the existing words.
- **Change:** listing the line sheet shows the words around the table; changing one reports what it was and what it is now; `add: true` puts a new line under what is there. In Excel each footnote line is its own row.
- **Files:** `lib/mouse/tools.ts` (`update_line_sheet`), `lib/line-sheet-xlsx.ts`

### Line sheet as Excel, beside the PDF · `2e219fb`
- **Change:** the wholesale line sheet downloads as an Excel file with the same rows as the PDF. Prices are numbers, not text, with an "up to" column for price ranges, and stock counts never appear. Emailing the sheet to a store attaches both files.
- **Files:** `lib/line-sheet-xlsx.ts`, `app/wholesale/line-sheet/xlsx/route.ts`, `lib/line-sheet.tsx`, `tests/line-sheet-xlsx.test.ts`. New dependency: `exceljs`.

### New products join the line sheet, with a suggested wholesale price · `0e6f928`, `cf8532e`
- **Change:** a product that goes on sale joins the wholesale line sheet straight away. If it has no wholesale price, Mouse asks for one and suggests a figure from what similar products sell at wholesale against retail.
- **Needs:** Shopify (product sync).
- **Files:** `lib/line-sheet.tsx`, `lib/mouse/agent.ts`, `tests/line-sheet.test.ts`

---

## Layout

### Only pressing customer support on the home page · `788e0a6`
- **Change:** the home page shows customer support only when a case is pressing, as one line in the alerts; everything else waits on the Support page. The tab badge counts pressing cases too.
- **Files:** `app/(main)/page.tsx`, `app/ui/nav.tsx`

### One main button per card · `43c5d29`
- **Problem:** two equally loud buttons on a support card, and the one tapped did less than the reply promised.
- **Change:** when a reply is drafted, Close and any second order action drop to an outline. Only the action that does what the reply says stays filled.
- **Files:** `app/ui/support-case.tsx`

### Urgent to-dos first, in pink · `e3733d2`
- **Change:** questions and to-dos that are marked urgent, due today, overdue or inside their reminder window sort to the top of every list and show in pink. The ToDo tab badge counts the same set.
- **Files:** `lib/pressing.ts`, `app/ui/item-row.tsx`, `app/(main)/items/page.tsx`, `app/(main)/page.tsx`, `app/ui/nav.tsx`, `tests/pressing.test.ts`

### Counts on the tabs · `43c5d29`
- **Change:** the tab bar shows a small count: to-dos and questions due today or overdue, and pressing support cases (on More on a phone). Nothing at zero. Counting everything open made a badge of 50 that nobody reads.
- **Files:** `app/ui/nav.tsx`, `app/ui/nav-bar.tsx`

### Product photos from Shopify · `43c5d29`
- **Change:** a small photo beside each product on Products and each piece on a stylist request, from the image already synced on each variant. Shopify's image CDN is asked for a small copy.
- **Needs:** Shopify (product sync).
- **Files:** `app/ui/primitives.tsx` (`Thumb`), `app/(main)/products/page.tsx`, `app/(main)/stylists/page.tsx`, `lib/stylist-stock.ts`

---

## Shopify and pages

### Shopify sync ignores archived listings · `46f5772`
- **Problem:** an old archived listing kept showing up as a product to sort out.
- **Change:** archived listings are skipped, as drafts already were.
- **Needs:** Shopify.
- **Files:** `lib/integrations/shopify-sync.ts`, `lib/mouse/tools.ts`

### Products page A to Z · `30cc04d`
- **Change:** products are sorted alphabetically within each group.
- **Files:** `app/(main)/products/page.tsx`

---

## Setup notes for a new install

- **Email limits:** Resend's free plan allows 100 emails a day, and mail received counts toward that too. A bulk send to customers needs a paid plan.
- **Sending from the main domain:** set the bounce subdomain to something other than the one that receives the assistant's mail (here `bounces`, because `send` handles inbound). Then the main domain's MX and SPF records, which belong to the company's own mail, stay untouched.
