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

### Support: one tap sends an invoice the team asked for, and Send refuses a false invoice claim · `872430a`
- **Problem:** telling the support drafter "create an invoice for her and send it" only rewrote the email to say an invoice was coming; the drafter has no tools, so nothing made one, and the reply could go out claiming it.
- **Change:** when a team instruction asks to invoice or charge, the drafter names the item and size; code finds the product and variant in Shopify, takes Shopify's price, checks stock and the customer's name, and the card shows "Send invoice & reply". That tap has Shopify create and email the invoice (she adds shipping and pays; the order appears when she does), notes it on the case, then sends the reply; a second tap never makes a second invoice. Any reply that says an invoice was sent or is coming is refused at Send unless this case sent one or Shopify shows one for that email in the last fortnight.
- **Files:** `lib/support/reply.ts` (`claimsInvoice`, `pickInvoiceProduct`, `INVOICE_NOTE`, the drafter's `newInvoice`), `lib/support/draft.ts` (`resolveInvoice`, `DraftInvoice`), `app/(main)/support/actions.ts` (`invoiceAndReply`, the Send check), `app/ui/support-case.tsx`, `app/(main)/support/page.tsx`, `prisma/schema.prisma`, migration `20261007120000_support_draft_invoice`, `tests/support-invoice.test.ts`
- **Needs:** Shopify (draft orders and invoices); a database migration (one nullable column).

### Morning brief gets cover worked out in code · `f73f802`
- **Problem:** the morning brief (one model call, no tools) was given each item's stock and the open PO lines but only shop-wide sales totals, and is told never to invent a number, so it could only say it "can't see" whether a delivery covers a shortfall.
- **Change:** for everything oversold plus the lowest few, code works out stock now, sales a day (the forecast's own weighted rate), what is due on open POs for exactly that variant and when, and what is left once it lands (or how short it stays), and hands those lines to the brief to use as given.
- **Files:** `lib/mouse/brief-cover.ts` (`coverLine`), `lib/mouse/brief.ts`, `lib/forecast.ts` (`ratePerDay` exported), `tests/brief-cover.test.ts`
- **Needs:** nothing external.

### A read-only Sonnet lane for plain look-up questions, off by default · `e7b074c`
- **Problem:** every chat turn ran on the most expensive model at high effort, including one-line look-up questions.
- **Change:** behind `MOUSE_READ_LANE=1` (off unless set), code routes a chat turn (`routeChat`, no model) to Sonnet at medium effort only when it is a short, single, plain question with no action or record word in any form (irregular ones spelt out), no request or correction, no call for judgement, no attachment or file in play, not an answer to the assistant's own question and not from a page's note box; "think hard", "use Opus" and the like always go to Opus. The read lane gets ten look-up tools only, enforced three ways (tools offered, the runner's allow-list, a guard before any tool runs), and skips the follow-up rounds that exist to make writes happen. If Sonnet replies with the hand-off marker, is declined, fails a tool, stops early or says nothing, the turn is re-run as the unchanged Opus turn and only that answer is shown and saved; the attempt is kept only as cost. Every reply's usage records `route` (lane, reason, model, effort, any hand-off and the attempt's requests).
- **Files:** `lib/mouse/route.ts`, `lib/mouse/agent.ts` (`READ_LANE_TOOLS`, `readLaneGuard`, `whyOpus`, `readLaneTurn`, `toolsFor`, `chatTurn`), `lib/mouse/runner.ts` (`TurnRoute`), `tests/route.test.ts`, `tests/read-lane.test.ts`
- **Needs:** an environment variable to turn it on. Nothing external.

### keep_file scoped to the chat it was called from · `78749e8`
- **Problem:** `keep_file` picked the newest chat attachment in the whole app, so with two conversations going it could keep someone else's file, and any run with the default tool set could call it.
- **Change:** it only chooses an attachment sent in the calling chat thread (still the last half hour, still by filename when several), and with no eligible one saves nothing and asks for the file again. Tools listed in `CHAT_ONLY_TOOLS` are given only to a run that has a chat thread (`toolsFor`), so background, email, in-flight and to-do runs never see it; called without a thread it refuses. The Files upload form gained a Notes field that is saved with the file.
- **Files:** `lib/files.ts` (`chooseChatAttachment`, `keepChatFile`, `uploadFromForm`, `storedFileData`), `lib/mouse/tools.ts` (tool context), `lib/mouse/agent.ts` (`CHAT_ONLY_TOOLS`, `toolsFor`, `chatThreadId`), `app/api/files/route.ts`, `app/(main)/files/file-controls.tsx`, `tests/keep-file.test.ts`
- **Needs:** nothing external.

### Files area: documents kept for good, linked to records · `ce25ec5`
- **Problem:** a supplier's colour card or spec sheet had nowhere to live. Chat attachments are cleared after about two months, and nothing tied a document to the components or vendors it was about.
- **Change:** a Files page (under More) to upload PDFs and photos up to 4 MB, give each a title and notes, and link it to products, components and vendors; each linked row shows "Files: …" with a link that opens it. The assistant can keep a file just sent in chat (`keep_file`, not from email), sees a record's files in `open_record`, and can read one (`read_file`). A tool result carrying `fileForModel` goes to the model as the document or image itself, not JSON, and the bytes are redacted from the saved chat turn. Files are searchable. Bytes are stored in Postgres (no outside storage) and never cleared by the storage cleanup.
- **Files:** `lib/files.ts`, `app/(main)/files/` (page, `file-controls.tsx`, `actions.ts`), `app/api/files/route.ts` (multipart upload), `app/files/[id]/route.ts` (open), `app/ui/file-links.tsx`, the products, components and vendors pages and `app/ui/component-row.tsx`, `lib/mouse/runner.ts` (`toolResultContent`), `lib/mouse/tools.ts` (`keep_file`, `read_file`), `lib/mouse/records.ts`, `lib/mouse/outcomes.ts`, `lib/mouse/agent.ts`, `lib/mouse/team-mail.ts`, `lib/mouse/stale-notes.ts`, `lib/search.ts`, `app/ui/nav-bar.tsx`, `app/ui/jump.tsx` (opening a folded row on a fresh page load), `prisma/schema.prisma`, migration `20261007000000_stored_files`, `tests/files.test.ts`
- **Needs:** a database migration (two new tables). Nothing external.

### Recipe lines for one colour of a product · `a7c2e79`
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

### Changing a to-do in place · `988e834`
- **Problem:** asked to mark an existing to-do urgent, the assistant had no tool for it, so it made an urgent copy and closed the original, losing its history.
- **Change:** an `update_todo` tool marks an open to-do or question urgent (or not), moves or clears its due date, or rewords it. Only what is passed changes. It refuses a closed item and hands back the open list when an id is mistyped.
- **Files:** `lib/mouse/tools.ts` (`update_todo`, `todoChanges`), `lib/mouse/agent.ts`, `app/ui/chat.tsx`, `tests/update-todo.test.ts`

### The last count is the last word · `988e834`
- **Problem:** a transfer took a place to 0 and a count minutes later set it to 2,000. The assistant saw both figures, logged them as a contradiction and did nothing.
- **Change:** the standing instructions say to read the item's ledger in order. The latest count at each place stands, and only what moved after it changes it. Only when the ledger cannot settle it does the assistant email the person who counts stock and ask for a count.
- **Files:** `lib/mouse/prompt.ts`

### Gifts from verified team email · `4bb2a00`
- **Problem:** a teammate emailing "send her a replacement at no charge" got "I couldn't do this": gifting was on the list of tools blocked from email, with the money and sending tools.
- **Change:** the gift tool runs from a verified team email (sent to the assistant, passing DMARC), and the email counts as the go-ahead. It is safe to allow because a gift only makes a $0 order that waits in the store for a person to make the shipping label. An address the teammate gives in their own email, or in mail they forward, may be used; a stranger's still may not. Invoices, refunds, purchase orders and outgoing mail stay blocked from email.
- **Files:** `lib/mouse/team-mail.ts` (`NOT_FROM_EMAIL`), `lib/mouse/nightly-pass.ts` (`APPLY_RULES`), `lib/mouse/tools.ts` (`gift_items`), `tests/team-mail.test.ts`

### Team email: write back only when it matters · `a141e49`
- **Problem:** every verified team email the assistant applied got a reply listing what it changed, even when the sender had simply passed on a fact. Routine updates made routine mail.
- **Change:** it records what the email says and writes back only for a concern, a question it needs answered, an answer they asked for, or something it could not do. Otherwise it stays silent and the change in the app is the record.
- **Needs:** email.
- **Files:** `lib/mouse/nightly-pass.ts` (`APPLY_RULES`)

### Research reports compare costs directly · `c83cffd`
- **Problem:** an outside research report said things were cheaper, but to know by how much the team had to look up what it pays now.
- **Change:** each task the agent reads carries `ourCosts`, what we pay now for every item it is about (its components, and those on its orders and products), from our own records. Reports carry `comparisons`, one per useful find, tied to an item by id, priced in the same unit, with a landed price where possible. The page shows each item with our price (from the records, not the agent's restatement), the price found and the difference, worked out in code only when both are in dollars per the same unit; otherwise both are shown side by side. A reported task can be sent back with a follow-up note (`send_back_to_muse`), which reopens it.
- **Files:** `lib/muse.ts` (`ourCosts`, `checkComparisons`, `compareRow`, `sameUnit`), `app/api/muse/tasks/[id]/route.ts`, `app/(main)/muse/page.tsx`, `lib/mouse/tools.ts`, `lib/mouse/team-mail.ts`, `prisma/schema.prisma` (`MuseTask.comparisons`), `docs/MUSE-API.md`, `tests/muse.test.ts`

### Handing research to an outside agent · `49ec1a8`
- **Problem:** some work needs the open web (finding a cheaper supplier worldwide, checking stock or lead times), which the assistant cannot do, and an outside research agent had no way to receive a task or ask about one.
- **Change:** the assistant can hand a task to an outside agent with a written brief, linked records and attached files (`hand_to_muse`), read what came back (`muse_tasks`) and close it. The agent polls a small key-protected API: list open tasks, read one, fetch its files, ask a question, post a report. Questions are answered by a model with no tools, from the brief and the task's own records only, or put to the team as an open question whose answer flows back. Reports are stored and shown as information and announced to whoever asked. The agent can change nothing else. Off until an API key of 32+ characters is set; limits on question count and size. A page lists the tasks, questions and reports.
- **Needs:** email (the report notice). Set `MUSE_API_KEY`.
- **Files:** `lib/muse.ts`, `app/api/muse/`, `app/(main)/muse/page.tsx`, `lib/mouse/tools.ts` (`hand_to_muse`, `muse_tasks`, `close_muse_task`), `lib/mouse/context.ts`, `lib/mouse/team-mail.ts`, `proxy.ts`, `prisma/schema.prisma` (`MuseTask`, `MuseQuestion`), `docs/MUSE-API.md`, `tests/muse.test.ts`

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

### Tell Mouse on a support case makes the change, not just the reply · `988e834`
- **Problem:** on a support case, "Tell Mouse" only reached the toolless reply drafter. Asked to record something about the customer or add a to-do, it rewrote the email and changed nothing.
- **Change:** when the instruction asks for a change in the app (a to-do, a note, stock, the calendar, a record about the customer), the full assistant makes it first, as the person who typed it. It is given only their words and facts checked by code: the customer's name only if it is plainly a name, their email only if it is plainly an address, the order number, the category, and our own records under that email. It never sees the customer's email. Tools that send, invoice or move money are withheld; those stay with the card's taps. What it did goes on the case as a note, and the reply is redrafted knowing it. A note filed from email can never pass for one of these.
- **Change:** the reply drafter is shown the sender's own records, matched by email: open to-dos naming them, plus any brand-specific record kept on that email (here, items on loan; leave that part out or swap in your own).
- **Needs:** the support inbox (email).
- **Files:** `lib/support/tell.ts`, `app/(main)/support/actions.ts` (`tellMouse`, `actOnCase`), `app/(main)/support/page.tsx` (`maxDuration`), `lib/support/draft.ts`, `tests/support-tell.test.ts`

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

### A first delivery of something not on Shopify sets its stock · `988e834`
- **Problem:** a product made in the app and never listed on Shopify starts with stock unknown. Its first delivery was added to unknown, which stays unknown, so it read UNKNOWN on hand through gifts and wholesale shipments until someone counted it.
- **Change:** the first stock entry for a variant that has none, is not on Shopify, and is a delivery sets the count to what arrived. Anything else on an unknown count still stays unknown, and the tool now tells the assistant to ask for a count when it does.
- **Files:** `lib/stock-push.ts` (`localNextCount`), `lib/mouse/tools.ts` (`log_inventory_event`), `tests/stock-push.test.ts`

### PO PDF test reads letter-spaced headings · `988e834`
- **Problem:** the bilingual PO test failed because `pdftotext` reads the letter-spaced 7pt column headings as "A RT I C O L O". The document itself was right.
- **Change:** the check ignores spacing.
- **Files:** `tests/po-pdf.test.ts`

### No component left on no product · `1360ed7`
- **Problem:** the assistant created components named for their products ("Black leather (Bean Bag)") but never added them to any product's recipe, so they never showed on the product and the forecast could not count them. Sixteen built up unnoticed in five days; the page's own "not on a product yet" list was not enough.
- **Change:** `create_component` takes the product (and colour or size) it goes into and adds the recipe line in the same step, quantity unknown unless given; without one, it tells the assistant to ask. The assistant's context marks every non-packaging component on no product and lists them each turn, telling it to ask rather than guess. The daily email carries a line while any has sat on no product for over a day.
- **Files:** `lib/mouse/tools.ts` (`create_component`), `lib/bom.ts` (`onNoProduct`), `lib/mouse/context.ts`, `lib/mouse/daily-cheese.ts`, `tests/on-no-product.test.ts`

### Ping a teammate about an entry · `39b073d`
- **Change:** stylist requests and pulls have Ping buttons for two teammates. Tapping one opens a one-line optional note; sending emails them what the entry is (who, what, dates, what is still out), the note, and a link that opens the page at that entry. Built on the same send-to-teammate function as the assistant's corner items, from the person who tapped to the teammate's address on file.
- **Needs:** email.
- **Files:** `app/(main)/corner-actions.ts` (`emailTeammate`), `app/(main)/stylists/actions.ts` (`pingAbout`), `app/(main)/stylists/stylist-controls.tsx` (`PingButtons`), `app/(main)/stylists/page.tsx`

### Charge lines never hold an order open · `6445ca3`
- **Problem:** an order counted as fully received only when every line was, and a shipping, tax or fee line never "arrives", so an order with one stayed part-received for good after its goods came in.
- **Change:** a line with no component or product whose wording is a charge (shipping, handling, freight, tax, duty, fee, surcharge, discount, deposit, setup) is left out of the received check and of the close-out shortfall. Free-text lines for goods are unaffected.
- **Files:** `lib/po-receipts.ts` (`isChargeLine`), `lib/po-close.ts`, `tests/po-charge-lines.test.ts`

### Shipping supplies come off as orders ship · `9ce0b26`
- **Problem:** mailers, envelopes, boxes, tape and the rest stayed at their last hand count for weeks, as if nothing had shipped, so nothing could warn that they were running low.
- **Change:** a nightly step reads the packages shipped from Shopify (one per successful fulfilment, so an order sent in two parts is two packages; wholesale left out; cancelled fulfilments ignored) and takes each finished day's use off the studio's stock with packing rules: per item for things packed in their own container, and per package for the rest by how many loose items it holds (mailer, then large envelope, then box), plus per-package extras (an insert card, a fraction of a roll of tape). Entries are `USED`, marked as estimates, dated by the day they are for, and only ever cover days after the latest hand count, so a count resets them. The forecast takes these supplies' daily use from the last 28 days of deductions rather than from recipes, which would count the same boxes twice. Note: a Shopify order search of "A B OR A C" did not mean what it looked like and lost most orders; it now asks for orders changed since a day and filters fulfilments in code.
- **Needs:** Shopify.
- **Files:** `lib/packing.ts`, `lib/integrations/shopify.ts` (`fetchShippedOrders`, `packagesFrom`), `app/api/cron/nightly/route.ts`, `lib/forecast.ts`, `lib/mouse/tools.ts` (`writeEvent` exported, SYSTEM source), `lib/mouse/prompt.ts`, `tests/packing.test.ts`

### A recipe line per size or colour · `f63e6e0`
- **Problem:** a product's recipe held one line per component, so a material used in different amounts by size (3.44 sq ft of leather in the small bag, 4.48 in the larger) could not be recorded: the second figure overwrote the first. The forecast also read only the first line it found.
- **Change:** one line per component per size and colour (unique index `NULLS NOT DISTINCT`, so two all-variants lines still clash). The recipe tool finds a line by component and scope, turns an all-variants placeholder with no amount into the scoped line, and refuses to put an all-variants line with an amount beside a scoped one, since that would count those variants twice. The forecast adds every line for a component, each over the variants it fits. The assistant is told that leather "feet" means square feet and to use invoice square feet per skin as the estimate when converting.
- **Files:** `prisma/schema.prisma`, `prisma/migrations/20261007200000_bom_line_per_scope`, `lib/bom.ts` (`pickBomLine`), `lib/mouse/tools.ts` (`update_product_bom`), `lib/forecast.ts`, `lib/mouse/prompt.ts`, `tests/bom-lines.test.ts`

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

### Links in the daily email · `c15af59`
- **Problem:** the daily email listed what needed doing, but to act on a line you had to open the app and find it.
- **Change:** each line links to where it is dealt with: a to-do to its row on the items page, a purchase order to its own page, a run at a maker to its product's row, support and the tidy-up to their pages. The plain-text version prints the link under each line. A one-off note can be shown at the top of a chosen day's edition, fixed text keyed by date (`NEWS`), used here to say the lines are now links.
- **Files:** `lib/mouse/daily-cheese.ts` (`APP`, `sentenceHtml`, `newsFor`), `tests/daily-cheese-links.test.ts`

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

### Add a file from a product's own row · `d4ac71b`
- **Problem:** tech packs and spec sheets could only be uploaded from the Files page, then linked by hand, so people looked for them on the product and never found a way to add one there.
- **Change:** every product's fold shows its files (or "No files yet") and "+ Add a file", which uploads to Files already linked to that product. The closed line shows "· N files". `AddFileTo` works for components and vendors too. The upload code is shared with the Files page (`postFile`).
- **Files:** `app/(main)/files/file-controls.tsx`, `app/(main)/products/page.tsx`
- **Needs:** nothing beyond Files itself (no Shopify, no email).

### Style numbers and SKUs, with sent purchase orders frozen · `3bfd723`…`da83dd0` (seven commits)
- **Problem:** a brand moving to style numbers (a pattern code like TP101, SKUs nested as STYLE-COLOUR-SIZE) needs them stored, shown, checked and reported, without rewriting purchase orders already sent: the PO page and PDF read a variant's SKU live, so any SKU change would silently reprint every sent order.
- **Change:**
  - Sent POs: a variant line is frozen (SKU, name, colour, size, photo) when its order leaves draft; a draft reads live; a failed or dry-run send undoes the freeze; a resend never overwrites; a deliberate revision re-freezes that line. Backfill script, and a before/after render check (PDF text and page HTML) for every sent PO.
  - Data: Style (number never reused or deleted; statuses incl. PROPOSED and RETIRED), StyleCode (category, colour, size; CONFIRMED or PROPOSED), product style link, variant new SKU (unique) with its codes, old SKU untouched.
  - Rules in code: SKU regex and equality to style-colour-size, uniqueness, next number in a category (highest ever used plus one), size names to codes; a new code or number is PROPOSED with a question; only named people can confirm (checked against who is asking).
  - Seeding from CSVs, matched on product, colour and size (never forced; unmatched and ambiguous become questions).
  - Display: one setting (new with old in brackets, or new only); style numbers and SKU lists on Products; SKUs on the PO list; search on style number, old and new SKU; the assistant's catalogue and open_record carry them.
  - Kits: a product made up of other products (body plus same-colour part); availability is the lower of the parts, unknown if any count is, with the shared part's pool said plainly. Not a recipe; moves no stock.
  - Report: products without a style, missing codes or SKUs, SKUs that fail the format (app and the e-commerce platform), open PO lines without a style, proposals waiting; one line when nothing is outstanding. In the daily email, the context snapshot and the assistant's context.
  - Partner reference: printable page and PDF of confirmed styles and codes only, and how to read a SKU; behind sign-in.
- **Files:** `lib/po-snapshot.ts`, `lib/style-system.ts`, `lib/style-admin.ts`, `lib/style-report.ts`, `lib/style-reference.ts`, `lib/style-reference-pdf.tsx`, `lib/kits.ts`, `app/styles/`, `app/(main)/products/` (page, actions, sku-mode), `app/(main)/purchase-orders/page.tsx`, `app/po/[poNumber]/` (page, pdf-button), `lib/po-pdf.tsx`, `lib/search.ts`, `lib/mouse/tools.ts` (create_product pattern, style_numbers, create_colorway colour code, send/update PO freezing), `lib/mouse/context.ts`, `lib/mouse/records.ts`, `lib/mouse/prompt.ts`, `lib/mouse/daily-cheese.ts`, `lib/shopify-import.ts`, `lib/integrations/shopify-sync.ts`, `scripts/seed-style-system.ts`, `scripts/freeze-sent-pos.ts`, `scripts/po-render-capture.ts`, `prisma/migrations/20261008150000_style_system`, tests `style-system`, `po-snapshot`, `kits`.
- **Needs:** Shopify only to read each variant's SKU in the nightly sync (read only). No email.

---

## Setup notes for a new install

- **Email limits:** Resend's free plan allows 100 emails a day, and mail received counts toward that too. A bulk send to customers needs a paid plan.
- **Sending from the main domain:** set the bounce subdomain to something other than the one that receives the assistant's mail (here `bounces`, because `send` handles inbound). Then the main domain's MX and SPF records, which belong to the company's own mail, stay untouched.
