# Additions to Mouse since 3 October 2026

Every change made to Studio Mouse from 3 October 2026 on, newest at the bottom. Brandon asked for this on 4 Oct 2026.

**Why it exists.** On 3 Oct a code snapshot was taken for the new, general Mouse product that Brandon and Jonathan are building separately. It was taken at commit `aa300cc`. Anything below marked **after the snapshot** is not in that copy. Use this list to decide what to carry over by hand.

**How to keep it.** Add an entry with every change to Mouse, in the same commit. Write it in plain words, and include:
- the date
- the commit
- what changed and why
- the main files
- whether it would carry over to the new product:
  - **General:** any manufacturer would want it.
  - **Add-on:** it depends on Shopify, QuickBooks or email.
  - **Cleo only:** wholesale line sheet, stylists and the like.

---

## In the snapshot (3 Oct, up to `aa300cc`)

### 3 Oct · `3cf94d7` · Background jobs on Sonnet 5.5
- **What:** support triage and drafts, the nightly mail pass, the brief, digest, tidy and the customer check now run on Claude Sonnet 5.5, which costs about half as much. Chat, team email and the morning report stay on Opus 5.5.
- **Safety net:** a run that reads outside email retries on Opus if Sonnet's safety check declines it, so a declined batch can't sit unread every night.
- **Room to think:** support triage went from 400 to 2,000 output tokens and the brief from 1,000 to 4,000, because thinking counts against those limits.
- **Files:** `lib/mouse/agent.ts` (`BACKGROUND_MODEL`), `lib/mouse/nightly-pass.ts`, `lib/support/pass.ts`, `lib/support/draft.ts`, `lib/mouse/brief.ts`
- **Carries over:** General.

### 3 Oct · `880a86c` · Audit fixes for the newer models
- **Store-wide sales totals.** `query_status` "salesTotal" with no product now totals the whole store. Opus 5.5 had asked for this 11 times on its first day and been refused each time.
- **Drafts aren't failures.** An email, invoice or gift draft is no longer reported back to Mouse as a failed call.
- **Removed `request_deep_analysis`.** It switched to a "stronger model" that was the same model.
- **Honest refusals.** A safety refusal is reported as one, not as "reasoning limit", and server-side refusal fallback is switched on.
- **Standing rules fixed:**
  - the shell-button story told twice with opposite endings
  - a page list missing 8 pages
  - an out-of-date Money section
  - two document-language passages that disagreed
- **Actions record moved.** The app's record of what Mouse did now follows each reply instead of sitting inside Mouse's own words, where Mouse had started forging it.
- **Files:** `lib/mouse/tools.ts`, `lib/mouse/outcomes.ts`, `lib/mouse/runner.ts`, `lib/mouse/agent.ts`, `lib/mouse/prompt.ts`
- **Carries over:** General.

### 3 Oct · `554abbb` · Stock changes start from Shopify's live count
- **Why:** Brandon said Mouse should read Shopify's number before adding to it, because Shopify is the real-time one. Before this, 14 stock logs had been refused because the app's cached count was stale.
- **What:**
  - Mouse reads Shopify's available count at the studio right before each change.
  - It retries once if a sale lands in between.
  - It records Shopify's own movement first, so the ledger still adds up.
- **Files:** `lib/stock-push.ts`, `lib/integrations/shopify.ts` (`fetchAvailableAt`), `lib/mouse/tools.ts`
- **Carries over:** Add-on (Shopify).

### 3 Oct · `aa300cc` · Rules trimmed to rule plus reason
- **Stories cut:** about 30 incident stories became a rule and a one-line reason each. The rules went from 46.5k to 29.9k characters.
- **One ask-or-act rule:** "Ask, never assume" stays a hard rule. Beside it are the two things that aren't doubt: one plausible match, and a fact someone has just told Mouse.
- **Wrong tool name:** `create_action_item`, which doesn't exist, became `create_todo`.
- **Files:** `lib/mouse/prompt.ts`, `CLAUDE.md` §4
- **Carries over:** General.

---

## After the snapshot

### 4 Oct · `30cc04d` · Products page A to Z
- **What:** products are alphabetical within Selling, In the works and Retired. They used to be ordered most recently active first.
- **Files:** `app/(main)/products/page.tsx`
- **Carries over:** General.

### 4 Oct · `0e6f928` · New products join the wholesale line sheet at once
- **Why:** Brandon asked that any time a new product is officially added, wholesale updates automatically.
- **What:**
  - A product or colour that goes on sale gets its line-sheet row straight away. It runs after Mouse adds it, in a nightly step after the Shopify sync, and whenever the sheet is read.
  - A ToDo question asks for whatever the row can't print without: the wholesale price, and a description if Shopify has none.
- **Files:** `lib/line-sheet.tsx` (`lineSheetCatchUp`), `lib/mouse/agent.ts`, `app/api/cron/nightly/route.ts`, `app/(main)/manual/page.tsx`
- **Carries over:** Cleo only for now (wholesale). Worth it if wholesale becomes a module.

### 4 Oct · `cf8532e` · Mouse asks for a new product's wholesale price, with a suggestion
- **Why:** Brandon: "mouse should ask us wholesale price (and recommend one)".
- **The suggestion:** worked out in code, never by the model. It's Shopify's retail price times the median wholesale-to-retail ratio of the products already priced, rounded to the dollar. It also shows the spread and the closest product by retail price.
- **The question:** Mouse asks in the same reply that added the product, and the question also waits in ToDo. Nothing is set until someone answers.
- **Files:** `lib/line-sheet.tsx` (`suggestWholesale`, `retailFor`), `lib/mouse/agent.ts` (`withLineSheetQuestions`), `lib/mouse/prompt.ts`
- **Carries over:** Cleo only for now. The price-suggestion idea is general.

### 4 Oct · `54fb760` · Dismiss on "For Claude" items, and this log
- **Why:** Brandon: "we need to be able to dismiss For Claude entries."
- **What:** each "For Claude" card on the ToDo page has a Dismiss button. It closes the item like any other ToDo item: it leaves the list, and the record stays, marked dismissed.
- **Also in this commit:** this log, and the rule in `CLAUDE.md` that every change to Mouse is added here in the same commit.
- **Files:** `app/ui/gap-card.tsx`, `docs/ADDITIONS-SINCE-2026-10-03.md`, `CLAUDE.md`
- **Carries over:** General (the Dismiss button).

### 4 Oct · `46f5772` · Shopify sync ignores archived listings
- **Why:** Brandon on Mouse's question about an old Cleo Tee listing: "i don't understand this". The sync had reported a retired, archived Shopify listing (Black and White at zero) as "not in the app", and Mouse asked whether to bring it in.
- **What:** archived listings are now skipped the same way draft ones already were. Mouse no longer offers to import them.
- **Files:** `lib/integrations/shopify-sync.ts`, `lib/mouse/tools.ts` (`sync_shopify`)
- **Carries over:** Add-on (Shopify).

### 4 Oct · `0cbc580` · "Message everyone waiting" (Support)
- **Why:** Brandon: Cleo needs to email everyone who ordered a tee that hasn't shipped, "without shopify screwing something up". Shopify Email only reaches marketing subscribers, and 27 of the first 50 waiting customers weren't subscribed.
- **What:** a page under Support where you:
  1. Set the product and colours.
  2. Paste a subject and message.
  3. Check who gets it: a count, the order list, and one customer's email exactly as it will arrive.
  4. Send yourself a test.
  5. Send to everyone.
- **How it behaves:**
  - Each customer gets one email about their own order, from support@, with `{first_name}`, `{order}` and `{items}` filled in. No model writes or changes the wording.
  - Shopify is only read: no tags, edits, fulfilments or cancellations.
  - Sends are recorded per order (`CustomerNotice`), so nobody gets the same notice twice. A failed send is retried on the next tap.
  - Only a signed-in team member can send.
- **Files:** `lib/waiting-notice.ts`, `app/(main)/support/waiting/`, `app/ui/waiting-notice.tsx`, `prisma/schema.prisma` (`CustomerNotice`, migration `20261004230000_customer_notice`)
- **Carries over:** Add-on (Shopify plus email). Worth it: any maker with pre-orders needs this.

### 4 Oct · `68bfe2b` · Mouse can read the emails it sent
- **Why:** asked to send Jane a revised supply list, Mouse said "I didn't have the wording of today's earlier list" and worked the list out again from scratch. Brandon: "how can we make mouse smarter".
- **The cause was in the code:** `check_sent_mail` found the morning's email but returned only its subject, never its text. The chat history Mouse reads is the last 20 messages, and that conversation had 36.
- **What changed:**
  - `check_sent_mail` now returns the full text of the newest 5 matches and can filter by subject.
  - One rule: look up anything you said or sent earlier before saying you don't have it, and revise what was sent rather than starting over.
- **Files:** `lib/mouse/tools.ts`, `lib/mouse/prompt.ts`
- **Carries over:** General.

### 4 Oct · `fa647db` · PO 2389 put right, and why it went wrong
- **Why:** Brandon: "all i asked of mouse was to note that one silver bean bag needed to be delivered this week."
- **Three things went wrong:**
  - Mouse read "add to PO 2389: we need one silver bean bag this week" as one more bag (4 to 5), and said so, instead of asking.
  - It held back from writing the rush in the PO notes, though they were empty.
  - The PO's "For" line said "Cleo Bag — Silver" over five Cleo Bags and two Bean Bags.
- **Data fixed (PO 2389, still a draft):**
  - Silver Medium Bean Bags back to 4.
  - Printed notes: "Please deliver one of the Silver Medium Bean Bags this week. The rest of the order by October 25.", plus the Spanish.
  - "For" removed.
  - The silk to-do now says 4.
- **Code fixed:**
  - The PDF leaves "For" off any order covering more than one product (`forLine`).
  - `create_purchase_order` no longer requires a "For" product.
  - The PO notes field says a rush request belongs there and to write it.
  - Mouse's list of open orders now shows each order's printed notes.
  - Ask rule: saying which reading you took is not asking. When two readings would write different numbers, ask first.
- **Files:** `lib/po-pdf.tsx`, `lib/mouse/tools.ts`, `lib/mouse/context.ts`, `lib/mouse/prompt.ts`
- **Carries over:** General.

### 4 Oct · `fa647db` · Mouse can search the whole chat
- **Why:** Brandon said yes to making Mouse smarter after it lost a list from earlier in a long conversation. Mouse only sees the last 20 messages of the current chat.
- **What:**
  - New `search_chat` tool: searches every chat message by its words, any day (default 14 days back), newest 10, with who said it and the text.
  - The rule about looking things up now names it.
  - Look-up tools (`check_sent_mail`, `search_chat`, the find tools and others) no longer count as writes.
- **Files:** `lib/mouse/tools.ts`, `lib/mouse/outcomes.ts`, `lib/mouse/agent.ts`, `lib/mouse/nightly-pass.ts`, `lib/mouse/prompt.ts`
- **Carries over:** General.

### 4 Oct · A pink "Special" tab for one-off emails
- **Why:** Brandon: put "Message everyone waiting" in "a new tab called SPECIAL. This is where special one-off emails etc will go, so no one gets confused. Also make it pink."
- **What:**
  - Special sits under More, in pink. Nav items can now be marked pink.
  - "Message everyone waiting" moved there from Support. `/support/waiting` redirects to it.
  - Mouse's page list includes Special.
- **Files:** `app/ui/nav-bar.tsx`, `app/(main)/special/`, `app/(main)/support/`, `app/ui/waiting-notice.tsx`, `lib/mouse/prompt.ts`
- **Carries over:** General (a home for one-off sends).

### 4 Oct · Pictures in a Special email
- **Why:** Cleo's note to everyone waiting on a Black or White Cleo Tee ends with her handwritten signature and a collage of photos, "below the text" (Brandon).
- **What:**
  - "Message everyone waiting" has a "Pictures below the words" choice. The email gets an HTML version: the same words, then the pictures, attached inline (`cid:`) so mail apps that block linked images still show them. The plain-text part is unchanged.
  - Pictures come from a fixed list (`NOTICE_PICTURES`), files in `public/notice/`, so the page can never name a file of its own. Read from disk at send time; a missing file stops the send before anyone is emailed.
  - The page preview and the test send both show them. `sendEmail` attachments take an optional `contentId`.
  - First entry: Cleo's "love Cleo" signature, then a 12-photo collage (studio, packing, the Hulken runs, the post office dock). Customers' names and addresses on the shipping labels are blurred, since it goes to about a hundred other customers.
- **Files:** `lib/notice-pictures.ts`, `lib/waiting-notice.ts`, `lib/email.ts`, `app/(main)/special/actions.ts`, `app/ui/waiting-notice.tsx`, `next.config.ts`, `tests/waiting-notice.test.ts`
- **Carries over:** General (the mechanism); the pictures themselves are Cleo only.

### 4 Oct · support@cleocamp.com only when a person picks it, once
- **Why:** Brandon wanted Cleo's tee note to come from support@cleocamp.com: "i don't want mouse ever using support@ unless we tell it to. this is a one time thing."
- **What:**
  - Special has a tick box: "Send from support@cleocamp.com, this once." It's off by default; otherwise the notice comes from support@send.cleocamp.com as before.
  - Ticked, the sender reads just "Cleo" (Brandon: the note is from her and signed "love Cleo"). Everyday support replies stay "Cleo Studio".
  - `sendEmail` refuses any From on cleocamp.com itself (not send.cleocamp.com) unless that box was ticked for the send. The check sits in the one place every send passes through, so Mouse, the nightly pass, support replies and a mis-set `SUPPORT_FROM` can't use it. Shopify invoices from studio@ don't go through `sendEmail` and are unaffected.
  - Needs cleocamp.com added and verified in Resend (by Brandon) with the return path on `bounces`, so `send.cleocamp.com`'s inbox and the Google MX/SPF are untouched.
- **Files:** `lib/email.ts`, `lib/waiting-notice.ts`, `app/(main)/special/actions.ts`, `app/ui/waiting-notice.tsx`, `tests/waiting-notice.test.ts`
- **Carries over:** General (a guard on sending as the main domain); the address is Cleo only.

### 5 Oct · The line sheet as Excel, beside the PDF
- **Why:** Brandon: "I need our wholesale line sheet to be in excel format as well as our pdf."
- **What:**
  - `/wholesale/line-sheet/xlsx` downloads the line sheet as an Excel file: the same rows as the PDF, in the same order, held back for the same reasons. The heading, the date the prices are as of, and the press and contact lines are on it too.
  - Prices are numbers in dollars, so a store can sort and work with them. A price range fills a second "up to" column. A typed MSRP that isn't a price stays as written. There are no photos, and stock counts never go on it.
  - The Wholesale page has an "Excel" link next to Download. When Mouse emails the line sheet to a store (`send_line_sheet`), it attaches both files, and the email says so.
  - New dependency: `exceljs`. npm audit flags its uuid (v3/v5/v6 only) and a glob helper; this code uses neither.
- **Files:** `lib/line-sheet-xlsx.ts`, `app/wholesale/line-sheet/xlsx/route.ts`, `lib/line-sheet.tsx` (`lineSheetFileName` takes an extension), `app/(main)/wholesale/page.tsx`, `lib/mouse/tools.ts`, `lib/mouse/prompt.ts`, `tests/line-sheet-xlsx.test.ts`, `package.json`
- **Carries over:** General (any brand with a line sheet).

---

## Changes to records, not code

These were made directly in Cleo Camp's database or Shopify, not in the code. They don't carry over to the new product: they're Cleo Camp's own data. They're listed so the history is complete.

### 3 Oct · QuickBooks figures recorded
- The nightly routine recorded the 2 Oct figures on 3 Oct and the 3 Oct figures on 4 Oct. Every cross-check passed.
- Nothing about the routine changed.

### 4 Oct · Note: Black and White Cleo Tees below zero are pre-orders
- **Why:** Brandon: "don't worry about pre-orders. no tees have come in yet."
- **What:** a note on the Cleo Tee. The Black and White tees below zero in Shopify are pre-orders against the run at Antonio's (PO 2360), so Mouse shouldn't flag them or ask about them. When the tees arrive, Mouse logs them as RECEIVED against PO 2360, never as a count, which would wipe out the pre-orders still waiting to ship.

### 4 Oct · Story Dress and You Dress: "continue selling" notes replaced
- **Why:** Mouse's email to Cleo said "continue selling when out of stock" was still on for the Story Dress. That was wrong: it was switched off on 2 Oct. Mouse was going by a note written before the switch. Brandon: "tell mouse that re: story dress, it doesn't know".
- **What:** Shopify was checked on 4 Oct. All 8 Story Dress and all 6 You Dress sizes are set to stop selling at zero. The two old notes were retired and replaced with that fact.
- **Not yet done:** the email Mouse sent Cleo still carries the wrong line. A correction was offered but not sent.

### 4 Oct · PO 2389 and the silk to-do
- **PO 2389 (draft):**
  - Silver Medium Bean Bags back from 5 to 4.
  - The rush written into the printed notes, in English and Spanish.
  - The wrong "For: Cleo Bag — Silver" removed.
- **Silk to-do for Cleo:** now says 4 Silver bags.
- **Not yet done:** that day's silk email to Cleo and revised supply list to Jane both say 5 Silver bags. A correction was offered but not sent.

### 4 Oct · New database table `CustomerNotice`
- Added for "Message everyone waiting", by migration `20261004230000_customer_notice`. It's a new, empty table, and nothing else changed.

### Checked, not changed
- **Shopify, 4 Oct:**
  - Iceland isn't a shipping country. It was never set up, and no orders have come from there.
  - The Cleo Tee has an old archived listing in Black and White at zero.
  - 273 orders are open and not fully shipped, mostly Black and White tee pre-orders.
- **Domains, 4 Oct:** studiomouse.ai, mymouse.ai and shopmouse.ai showed as available.

---

## Outside this repo

- **3 Oct · Handoff document and code snapshot for the new product:**
  - `MOUSE-HANDOFF.md` describes what Mouse is, how it's built and what it can do, plus the setup steps for Jonathan. Say Cheese was added as a feature to build out.
  - A zip of the code at `aa300cc`: no git history, no secrets or data, real customer emails, names and a phone number replaced with made-up ones, and test files built on customer mail left out.
  - Neither was committed here. Both were handed to Brandon as files.
