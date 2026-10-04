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

### 4 Oct · Dismiss on "For Claude" items
- **Why:** Brandon: "we need to be able to dismiss For Claude entries."
- **What:** each "For Claude" card on the ToDo page has a Dismiss button. It closes the item like any other ToDo item: it leaves the list, and the record stays, marked dismissed.
- **Files:** `app/ui/gap-card.tsx`
- **Carries over:** General.

### 4 Oct · Shopify sync ignores archived listings
- **Why:** Brandon on Mouse's question about an old Cleo Tee listing: "i don't understand this". The sync had reported a retired, archived Shopify listing (Black and White at zero) as "not in the app", and Mouse asked whether to bring it in.
- **What:** archived listings are now skipped the same way draft ones already were. Mouse no longer offers to import them.
- **Files:** `lib/integrations/shopify-sync.ts`, `lib/mouse/tools.ts` (`sync_shopify`)
- **Carries over:** Add-on (Shopify).

### 4 Oct · "Message everyone waiting" (Support)
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
