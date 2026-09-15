# HANDOFF — technical, for the next coding agent

Written 13 September 2026. This supplements `README.md`, `CLAUDE.md` and
`SPEC.md` — it doesn't repeat them. Delete or rewrite this file once it goes
stale; it's meant to be replaced, not accumulated.

## Read first, in this order

1. `CLAUDE.md` — the non-negotiables. Every line was earned by something
   breaking. Read before touching data, secrets, or Vercel/Neon infra.
2. `SPEC.md` — full design reasoning.
3. `docs/seed-facts.md` — a dated snapshot of what Brandon said on 1 Sept
   2026, not a live description. Don't treat it as current truth.
4. This file — durable technical knowledge not obvious from reading the code.
5. `prisma/schema.prisma`, `lib/db.ts`, `lib/mouse/tools.ts` — see "Most
   important files" below.

## Architecture

Next.js 16 app (App Router), Postgres via Prisma 7, deployed on Vercel
Hobby. Auth is a single shared password → a signed cookie (`lib/session.ts`,
`SESSION_SECRET`, `jose`) — there is no per-user identity; `Person` rows are
attribution, not accounts.

**Studio Mouse** (`lib/mouse/`) is the conversational layer — an
Anthropic-SDK-driven chat agent with tools (`lib/mouse/tools.ts`, large file)
that read/write the real schema. `lib/mouse/runner.ts` drives the
tool-calling loop; `lib/mouse/prompt.ts` builds its system prompt;
`lib/mouse/context.ts` decides what data it's shown. It talks to Cleo mainly
through `/api/chat`.

**Automation runs on Vercel Cron**, not inside any chat session:
- `/api/cron/nightly` (`vercel.json`, 12:00 UTC): calendar sync, Shopify
  sync, Mouse's "think" pass, forecast, alerts, digests. Read this file
  top-to-bottom before changing any of these — they share one run and one
  `step()` wrapper that logs failures per-step without aborting the rest.
- `/api/cron/am-report` (15:00 UTC): the morning report.
- Both are guarded by `CRON_SECRET` (bearer token), not the session cookie —
  nothing calling them can hold a login.

**`/api/finances`** is a third write path into `FinancialSnapshot`, also
`CRON_SECRET`-guarded, meant for an external scheduled routine to post
figures without Studio Mouse holding Intuit credentials. See "Known issue"
below — it's easy to assume this is *the* financials pipeline and it isn't,
fully.

**`/api/gap`** — "Studio Mouse couldn't do this," filed from chat. Stores a
pointer (the `ChatMessage` id), not a copy, so whoever picks up the gap sees
the exact exchange and tools Mouse actually reached for. Worth checking when
asked to fix "Mouse can't do X" — the gap may already be filed with useful
detail.

## Local setup

```bash
npm install
npx prisma generate
npm run dev
```

Env vars are set by hand, never via a Vercel Storage integration (CLAUDE.md
§1). Names only, from `.env.example` — get values from Vercel/Neon/Resend
dashboards, never paste them into a terminal or ask the user for them:

```
DATABASE_URL, DIRECT_URL          — Neon, pooled / unpooled (see below)
ANTHROPIC_API_KEY                 — Studio Mouse
RESEND_API_KEY, EMAIL_FROM, RESEND_WEBHOOK_SECRET
SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET, SHOPIFY_STORE_DOMAIN
ADMIN_PASSWORD, SESSION_SECRET
CRON_SECRET
CALENDAR_FEED_URL
DIGEST_RECIPIENTS, INBOUND_ALLOWED_MAILBOXES
INVENTORY_WRITES                  — feature flag, see CLAUDE.md §3
APP_TIMEZONE                      — should be America/Los_Angeles; CLAUDE.md §5
QBO_CLIENT_ID, QBO_CLIENT_SECRET, QBO_REDIRECT_URI  — deliberately empty, see below
```

**Vercel marks Production values sensitive by default; `vercel env pull`
returns an empty string for those, not an error.** Empty ≠ unset — check with
`--no-sensitive` before concluding something's missing, and never delete on
that basis.

**One shared database. No staging.** Local, preview, and production all
point at the same Neon database, and local runs use the *real* Resend key.
Set `EMAIL_DRY_RUN=1` (checked inside `sendEmail()` itself) before running
anything that might send mail. Read freely; think before writing.

## The two Neon connections — read this before touching `lib/db.ts` or the scripts

Two different connection strings, two different transports, not
interchangeable:

- **`DATABASE_URL`** (pooled) — used by `lib/db.ts`, the app's runtime
  client, via **`@prisma/adapter-neon`** (Neon's own HTTP/WebSocket driver,
  not raw `pg`). This is deliberate: it's what lets the app's database calls
  work from a Claude Code cloud session, which can only make outbound
  HTTP(S) calls — a raw TCP socket (what `@prisma/adapter-pg`/`pg` opens)
  has no path out of that sandbox. Confirmed working, including Prisma
  interactive transactions (`$transaction(async tx => ...)`), which
  `lib/mouse/tools.ts` relies on to write `InventoryEvent` and `onHandQty`
  together (CLAUDE.md §3).
- **`DIRECT_URL`** (unpooled) — used directly by `prisma.config.ts`
  (migrations) and by four other entry points that each build their own
  `PrismaClient` with `@prisma/adapter-pg`: `prisma/seed.ts`,
  `scripts/sync-shopify.ts`, `scripts/sync-calendar.ts`, and
  `scripts/audit-sight.ts` (which uses raw `pg` directly, no Prisma). **None
  of these five things can run from a Claude Code cloud session** — same
  raw-TCP wall. They work fine locally and on Vercel. `scripts/sync-shopify.ts`
  and `scripts/sync-calendar.ts` are explicitly for a first import or full
  rebuild only — the nightly cron does the real syncing automatically, on
  Vercel's own infrastructure, via `lib/db.ts`, unaffected by any of this.

Both `@prisma/adapter-pg` and `@prisma/adapter-neon` are dependencies on
purpose — don't "clean up" by removing either without checking all five call
sites above.

## Commands

```
npm run dev            next dev
npm run build           prisma generate && next build
npm test                node's built-in test runner, tests/*.test.ts — no network, no DB, 12 tests
npx tsc --noEmit         typecheck — see known pre-existing failures below
npm run db:migrate       prisma migrate dev   (needs DIRECT_URL, local machine only)
npm run db:deploy        prisma migrate deploy
npm run db:studio        prisma studio
npm run seed             tsx prisma/seed.ts — first import / rebuild only, see above
npm run sync:shopify     full Shopify history rebuild, see above
npm run sync:calendar    full calendar rebuild, see above
npm run audit:sight      tsx scripts/audit-sight.ts — checks Studio Mouse's tools/context cover every schema model; run after adding a model
```

One-off inspection: write `.tmp-*.ts`, run with `npx tsx`, delete when done.
`.tmp-*` is gitignored — this is the expected workflow, not a shortcut.

## Deployment

Vercel Hobby: no long-running processes, cron fires once daily per job and
only within its scheduled hour (`vercel.json`). Neon is `us-west-2`; Vercel
functions run in US East — batch queries, don't chain them across the
round-trip.

Shared Vercel account with other apps (`tcb`, `still-typing`,
`a-benji-christmas`, `rome`, `peaches`) — this app has its own Neon project,
own Vercel project, own GitHub repo, on purpose (CLAUDE.md §1). Never touch
Vercel's Storage tab for this project. Never run a destructive Vercel/Neon
CLI command without explicit confirmation in the conversation.

## Integrations

- **Shopify** — permanent master for finished-goods counts; this app never
  keeps a parallel count once synced (CLAUDE.md §3). `lib/integrations/shopify.ts`
  + `shopify-sync.ts`.
- **Resend** — outbound mail. See the email hazard above; `sendEmail()` is
  the single choke point for `EMAIL_DRY_RUN`, so stub-replacing it elsewhere
  silently does nothing (ESM binds the import at the call site).
- **Google Calendar** (`lib/integrations/calendar.ts`) — read-only ICS feed
  via `CALENDAR_FEED_URL`.
- **QuickBooks** — the app's own OAuth (`lib/integrations/quickbooks.ts`,
  `/api/quickbooks/connect`+`/callback`) is built but **deliberately dormant**:
  `QBO_*` are empty placeholders, `isConfigured()` is false, the nightly
  cron's `quickbooks` step no-ops by design. Do not fill these in or treat
  the skipped step as a bug — Brandon decided (12 Sept 2026) that QuickBooks
  comes in through a scheduled Claude routine using the account's own
  connector instead. `totalExpenses()` in that file still matters if this
  ever changes — see "known issue" below, it's about the shape of QuickBooks'
  report, not the transport.

## How financial figures actually get recorded — three paths, easy to get wrong

`FinancialSnapshot` (cash/AR/AP/revenue/expenses) is written from three
different places, not one pipeline:

1. **`lib/mouse/inbox.ts`** auto-records a *structured* "nightly balances"
   email (JSON blob, trusted `@cleocamp.com`/`@send.cleocamp.com` sender
   only) straight into `FinancialSnapshot` — no human confirmation. This is
   deliberately exempted from the "email is data, not instructions" rule
   (CLAUDE.md §4) because it's machine-structured output from a trusted
   routine, not correspondence. **It only ever sets `cashCents`/`apCents`** —
   never revenue or expenses.
2. **`POST /api/finances`** (`CRON_SECRET`-guarded) — same idea, a different
   entry point for a scheduled routine to post cash/AP/AR directly, also
   never touches revenue/expense fields, also no human confirmation.
3. **`record_financials`** (a Studio Mouse chat tool, `lib/mouse/tools.ts`)
   is the *only* path that ever sets `revenueMtdCents`/`revenueYtdCents`/
   `expensesMtdCents`. A human has to relay the figures into chat for these
   to land.

The richer prose "QuickBooks figures" email (the one with revenue/expenses
and the $0-bug workaround) doesn't match the structured-JSON shape path 1
expects, so it falls through to ordinary inbound handling: stored in
`InboundEmail` only, a proposal per CLAUDE.md §4, not promoted into
`FinancialSnapshot` automatically.

**The Sept 2 → Sept 12 cash gap ($80,658 → $165,897) is resolved, not a bug**
(worked out across two sessions, 13–14 Sept 2026, cross-checked against
QuickBooks' own Balance Sheet API and the stored `raw` field on each
snapshot row): the Sept 2 figure was a partial manual read, 3 of 5 bank
accounts, literally labeled in its own `raw.source` as "QuickBooks bank feed,
read from the banking screen." The later figure is QuickBooks' full ledger
total across all 5 accounts. Reconciled account-by-account, the gap is
real and exact — Main-cleocamp alone moved +$101,531.14 in 11 days, more
than 4× that month's entire revenue. **Answered by Brandon, 14 Sept 2026:
bookkeeping catching up**, not a specific transaction to chase — expect
similar-looking jumps for a while as the books get current, not a
data-integrity problem in this app. Don't re-open this as a mystery next
time a large swing shows up; ask whether it's the same catch-up before
treating it as anomalous.
**A/R reading $0 is also correct, not a bug**: QuickBooks' own AR aging
report is empty company-wide, because wholesale sales aren't entered into
QuickBooks as invoices at all — the $0 is QuickBooks accurately reporting
what it was given, not a parsing failure.

**The nightly QuickBooks routine was deleted, then recreated and verified
working, 14 Sept 2026.** Confirmed deleted via `list_triggers` (zero on the
account, ever) before rebuilding. Two things learned rebuilding it, both
repo-relevant if it ever needs touching again:
- **This org disables passing MCP connectors to a Routine's fresh-session
  firings** (`create_trigger`'s `connectors` param errors outright: "not
  available for this organization"; omitting it still fires connector-less
  sessions). The workaround that actually works: bind the trigger to an
  *existing* session that already holds the connectors (self-bind — omit
  both `persistent_session_id` and `create_new_session_on_fire`), since
  nothing needs to be "passed" to a session that already has them. This is
  a platform/org constraint, not something fixable in this repo.
- **`processInbox()` (the JSON auto-parser) only runs inside
  `/api/cron/nightly`, once a day** — it does not fire on receipt. An email
  landing mid-day sits as an unprocessed `InboundEmail` row, correctly,
  until the next nightly pass. Confirmed end-to-end 14 Sept: sent a real
  figures email, it landed unprocessed, calling `processInbox()` directly
  (not the full nightly route — that also does Shopify sync, digests, etc.,
  not appropriate to trigger as a side effect) processed it and wrote a real
  `FinancialSnapshot` row for cash/AP, exactly as designed.

The new routine fires nightly at 7pm Pacific (`0 2 * * *` UTC), self-bound
to the coding session that built it — so it's tied to that session's
lifetime, not a standalone routine. If that session is ever deleted, this
stops firing silently, the same failure shape as before. Check
`list_triggers` if financials go stale again rather than assuming the app
is broken. (Briefly disabled 14 Sept to protect a manual cash figure from
being overwritten — moot within the hour once cash was dropped from the
page entirely; re-enabled same day, running normally.)

**Cash was dropped from the Finances page entirely, same day (14 Sept
2026), superseding the three-account definition above almost immediately.**
Sequence, since it's a good example of how fast a "fix" can become the
wrong fix: first the page showed the full 5-account ledger sum; then
narrowed to three specific accounts (PERFBUS CHK, Main-cleocamp, Sales
Tax-cleocamp) per Brandon; then, once it was clear the automated routine
could only ever produce the *ledger* value for those accounts — not the
true bank-feed balance QuickBooks itself shows, which this connector has no
API for — Brandon said plainly he won't do the manual "check the Banking
tab and tell Studio Mouse" workflow that would be needed to keep it
accurate. So cash is gone from this page, full stop. Don't reintroduce it
without a real fix for the bank-feed-API gap (see below) — narrowing which
accounts count was never the actual problem.

**The Finances page now shows Profit & Loss (revenue, expenses, net
income — MTD and YTD) instead.** P&L doesn't have the bank-feed-vs-ledger
problem — QuickBooks' own reports are the right source once the $0-expenses
bug is worked around (see `lib/integrations/quickbooks.ts` and the
Known Issues section below). `app/(main)/finances/page.tsx`'s title changed
from "Cash" to "Profit & Loss"; the old "Position" card (Cash/Receivables/
Payables) is gone, replaced by a "Year to date" card.

**Schema gap, not yet fixed: `FinancialSnapshot` has `revenueYtdCents` but
no `expensesYtdCents` column.** `record_financials` (the chat tool) and the
routine both compute YTD expenses but had nowhere typed to put them. As a
stopgap, `expensesYtdCents` rides inside `raw.pnl.expensesYtdCents` (a plain
number, cents) instead — the Finances page reads it from there, with a code
comment explaining why. This session can't run a migration to add a real
column (no `DIRECT_URL`, and raw TCP doesn't work from a Claude Code cloud
session regardless — see the Neon section above). **Promote this to a real
column next time someone has local or `DIRECT_URL` access**, and update
`record_financials` to accept `expensesYearToDate` as a proper input the
same way `revenueYearToDate` already is.

**The QuickBooks bank-feed API gap itself is still real and unaddressed** —
this connector has no tool for the live "Bank Balance" QuickBooks shows on
its own Banking page, only the reconciled ledger, confirmed by checking
every tool the connector exposes. The ledger can read tens of thousands off
the true balance during bookkeeping catch-up (seen directly 14 Sept:
Main-cleocamp ledger $120,067.39 vs. its actual bank balance $39,837.25).
This is *why* cash got dropped rather than fixed — there's no automated
path to the real number without either Intuit exposing a bank-feed API this
connector adopts, or browser/vision access to a logged-in QuickBooks
session (deliberately not attempted — no credentials available, scripting a
login isn't appropriate here). If cash ever needs to come back, this gap is
still the blocker, not something that got resolved along the way.

**`app/(main)/finances/page.tsx` also had a real, separate bug earlier the
same day, fixed on `main` (`e57679b`, merged into this branch):** it
fetched `cashCents`/`arCents`/`apCents` and defined a `money()` formatter
for them, but never called `money()` anywhere in the JSX. Moot now that
cash is gone from the page, but the underlying lesson — a value fetched and
formatted but never actually rendered — is a shape worth watching for
elsewhere.

## Conventions

- Money: `Int`/`BigInt` cents. `315` = $3.15.
- Quantity: `Decimal(12,3)` — fabric is fractional yards.
- Dates: America/Los_Angeles always; never compute a boundary in UTC
  (`APP_TIMEZONE`, `@date-fns/tz`).
- `InventoryEvent` is append-only — never edit or delete; corrections are
  new `CORRECTION` events with `correctsEventId`. `onHandQty` is a
  materialized sum, written in the same transaction as the event that
  changes it, and must be recomputable from the ledger alone.
- BOM `qtyPerUnit` of `0` means *unknown*, not zero — rendered as unknown,
  counted as a gap, skipped by the forecaster.
- `Component.stockedInStudio` is a fact about a specific purchase, never
  inferred from category — most trim/hardware lives at a vendor, not the
  studio (CLAUDE.md §3, corrected 10 Sept 2026 — this used to say the
  opposite and was wrong).
- Fabric is never modeled as stock anywhere, by design — bought per
  production run, shipped straight to the manufacturer.

## Dangerous areas

- Vercel Storage integration tab — never connect one to this project
  (CLAUDE.md §1; this has destroyed another project's data before).
- Destructive Vercel/Neon CLI commands — confirm in-conversation first,
  always.
- Anything that sends mail — real key, real people, no dry-run unless you
  set the flag yourself.
- `InventoryEvent`/`onHandQty` writes outside a shared transaction — breaks
  the "recomputable from the ledger" invariant silently.
- Auto-forwarding inbound mail — removed entirely, asked for three times by
  Brandon. If a request sounds like "narrow the forwarding filter again,"
  stop and ask whether the feature should exist at all before writing code.

## Known issues / gotchas (verified this session unless marked otherwise)

- **Fixed 15 Sept 2026: "Sold yesterday" (Home page stat tile, Mouse's
  Corner brief, and the DAILY digest) silently included whatever of
  *today* had already synced in, on top of yesterday.** All three built the
  range as `date: { gte: laMidnight(1) }` — bounded below, never bounded
  above — so it summed yesterday plus every `SalesSnapshot` row from today
  so far. Confirmed on real data: showed 43 when yesterday alone was 23
  (the other 20 was today's partial sync, already landed by the time the
  page was checked at 5pm). Fixed by adding `lt: laMidnight(0)` to all
  three (`app/(main)/page.tsx`, `lib/mouse/brief.ts`,
  `lib/mouse/digest.ts` — the last one only for `kind === 'DAILY'`;
  WEEKLY/MONTHLY are legitimately open rolling windows through now, not a
  single past day, and keeping them unbounded is correct). **If a "last N
  days" figure elsewhere ever looks inflated, check for this exact
  `laMidnight(days)`-with-no-upper-bound shape before assuming the data
  itself is wrong** — `lib/mouse/tools.ts`'s `salesTotal`/`sales` chat
  tools were checked and are fine, since a rolling "sales in the last N
  days, right now" window is supposed to include today so far; only a
  query meant to represent one specific bounded past day (like
  "yesterday") needs the upper bound.
- **Fixed 14 Sept 2026: `log_inventory_event` wrote the literal string
  `"undefined"` into `deltaQty` for every COUNTED event, rejected by the
  Decimal column — real production incident (all eight Story Dress
  variants).** Root cause was a self-contradicting tool definition: the
  input schema listed `deltaQty` as `required`, but the tool's own
  description told the model "For COUNTED give countedQty — deltaQty is
  then ignored" — so the model correctly omitted it, and every write site
  in `lib/mouse/tools.ts` did `String(args.deltaQty)` unguarded. Fixed at
  the root: `deltaQty` removed from `required`, `writeEvent` now derives it
  from `countedQty` against the previous quantity (at all three write
  sites — MATERIAL, other components by place, product variants) instead
  of trusting it arrived, and refuses cleanly (a normal tool-result error,
  not a corrupted write) if genuinely neither was given. Verified against
  live Shopify data before touching anything: `get-inventory-levels`
  confirmed all 8 variants already matched Cleo's count exactly, so nothing
  needed re-pushing — only the missing ledger events (`deltaQty: 0`,
  `countedQty` set) were backfilled, restoring `onHandQty`'s
  recomputable-from-the-ledger invariant (CLAUDE.md §3).

  **Follow-up same day, prompted directly by Brandon:** a variant whose
  local `onHandQty` was unknown made `log_inventory_event` refuse to push
  to Shopify at all ("sync from Shopify first") — correct caution in
  principle (never guess a delta with no baseline), but unnecessary,
  since Shopify itself always knows even when our cache doesn't. Added
  `fetchInventoryQuantity()` (`lib/integrations/shopify.ts`) — a live
  single-variant read, `node(id) { ... on ProductVariant { inventoryQuantity } }`,
  validated against the real API before shipping. `writeEvent` now falls
  back to it whenever the local count is unknown and a push is actually
  about to happen (for a stated count *and* a plain add/subtract — not
  only COUNTED), and the tool's reply says plainly when that live check
  is what supplied the baseline, so a surprising number is something a
  human notices rather than something that happened silently. Brandon's
  framing, worth keeping in mind for this whole tool: a stated count is
  always master, no confirmation needed; a movement against an unknown
  local count should make Mouse go check Shopify itself rather than
  punt back to a person — "think like a person would, not a robot."
- **`npx tsc --noEmit` reports two pre-existing failures** —
  `app/layout.tsx` and `app/(main)/layout.tsx`, "Cannot find name
  'LayoutProps'." Confirmed via `git stash` that these exist independent of
  any change; likely Next's generated `.next/types` not having been built
  yet in a fresh checkout. Not caused by app code — don't chase it as a
  regression.
- **Restart the dev server after `prisma migrate`** — stale client, wrong
  shape, no error.
- **Vercel sensitive env vars pull empty** — see above.
- **QuickBooks' "Total Expenses" and group `displayValue` fields read $0.00**
  when real expenses exist — a trend-calculation bug with no prior-year
  comparable. `totalExpenses()` in `lib/integrations/quickbooks.ts` prefers
  Gross Profit − Net Operating Income (exact identity), cross-checks against
  summed line items, and only falls back to the headline field last. Two
  specific traps documented in that file's comments: `summaryBreakdown.netOperatingIncome`
  is actually Net *Income*, not NOI; and naive leaf-summing double-counts
  because "Total for X" rows sit as siblings of the rows they total.
- **The QuickBooks Routine is gone, not broken** — see the financial-figures
  section above. If cash/revenue look stale, check `list_triggers` before
  assuming it's a code bug; it needs recreating, not debugging.

## Active work / open data gaps (state, not code — re-verify before acting)

Tracked as open `ActionItem`s in the live data as of 13 Sept 2026, not
necessarily current by the time you read this — query the table rather than
trust this list:
- Whether wholesale invoices are entered in QuickBooks at all — resolved,
  see above: they aren't, so A/R reading $0.00 is correct, not a gap.
- Denim cost/yard for the current vendor (United Leather) is unknown — the
  prior vendor's price doesn't carry over (CLAUDE.md §3, don't inherit a
  replaced vendor's pricing).
- Denim cost/yard for the current vendor (United Leather) is unknown — the
  prior vendor's price doesn't carry over (CLAUDE.md §3, don't inherit a
  replaced vendor's pricing).
- Per-colour leather/snaps/buttons for each Cleo Bag colorway variant, and
  Petite Bateau handle material, are unspecified.
- Sixteen suppliers in Cleo's own tracking sheet aren't in the system —
  left out deliberately (read as a sourcing shortlist, not live accounts).
- 35 of 73 BOM quantities are unknown (by design — see BOM convention
  above, this is a visible gap, not corrupted data).
- The parent "Cleo Bag" product is sunsetted (split into five per-colour
  products) but still referenced by three purchase orders — not deleted on
  purpose.

## Most important files to read first

| File | Why |
|---|---|
| `CLAUDE.md` | Non-negotiables — read before anything else |
| `prisma/schema.prisma` | The whole data model and its invariants, in comments |
| `lib/db.ts` | Runtime DB client — small, but the adapter choice matters, see above |
| `prisma.config.ts` | Why migrations use a different connection than the app |
| `lib/mouse/tools.ts` | Every write Studio Mouse can make — large, but this is where the CLAUDE.md invariants are actually enforced in code |
| `app/api/cron/nightly/route.ts` | Everything that runs automatically, once a day, unattended |
| `lib/integrations/quickbooks.ts` | The $0-expenses bug workaround, and why the OAuth path is dormant |
