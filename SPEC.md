# Cleo Camp Studio Admin — specification

Written 2026-09-01, brought current 2026-09-10. Every decision below was made
deliberately; where the reasoning matters, it is recorded, because this gets
picked up cold in later sessions.

**Phase 0 is over.** Shopify writes through, Studio Mouse sends its own
purchase orders, and inbound email is live. Sections that described those as
future work were wrong for about a week before anyone noticed, which is the
argument for reading this against the code rather than trusting it — where the
two disagree, the code is right and this file is a bug.

---

## 1. What this is

An internal admin app for **Cleo Camp**, a small DTC apparel brand in Los
Angeles. Its job is to know what's in the studio, notice what's running out,
and tell Cleo what to order and when — before she runs out, not after.

The assistant layer is **Studio Mouse**. The end user (Cleo) is not technical
and checks this from her phone in the morning. Every design decision favors a
single conversational interface over forms, and favors asking a question over
guessing.

## 2. Business context

- **Shopify is the only live sales channel.** Squarespace hosts DNS only.
  Sales moved to Shopify in April 2026.
- Growth is steep and recent: $8.1k (Apr) → $34.1k (May) → $28.9k (Jun) →
  $33.5k (Jul) → **$67.7k (Aug)**. A trailing average will badly under-forecast
  a curve like this. Weight recent weeks heavily and say so when actual sales
  outrun the projection.
- **Wholesale** accounts are invoiced through QuickBooks separately, but
  QuickBooks is **not** an inventory trigger. Physical shipment, logged in chat
  at the moment it happens, is the trigger.
- **All inventory is in Cleo's studio.** One location. A 3PL is 2027 business —
  the schema carries a location field so that becomes a migration, not a
  rewrite, but nothing else is built for it.
- Products, as of 2026-09-10: Cleo Tee (multiple colorways), You Dress, Story
  Dress, Cleo Bag (now three Shopify listings — Earthy Chocolate Suede, Silver,
  Black Leather — plus Denim), Bateau Bag, Petite Bateau Bag, Bean Bag, Cachet,
  Olive Bag, Boy Belt, Splash Photo Book. Little Sister is sunsetted.
- In development: Cosmo Stripe Tee (Cosmopolitan collab), Long Sleeve Cleo Tee,
  Cleo Underwear, New Skirt ("Cleo Skirt 001" / 5to7), Scoop Neck Dress, a
  sweater, a red bag, a hair tie.
- **Sizes are inconsistent across the catalogue.** The tees and dresses carry
  numeric sizes (1, 2, 3) that came down from Shopify and are Shopify's to
  change. The skirt and underwear use XS–XL. Bags and belts use words
  ("Petite", "Medium"). Nothing is wrong here, but a size is a label, not a
  key — `rename_variant_sizes` relabels a whole run without disturbing what
  points at it, and refuses on anything Shopify owns.

See `docs/seed-facts.md` for confirmed vendor, price, and product data.

## 3. Stack

- Next.js 16, App Router, React 19, TypeScript, Tailwind 4, Turbopack.
  Route protection lives in `proxy.ts`, which replaces `middleware.ts`.
- Prisma 7 against Neon Postgres, via `@prisma/adapter-pg`. Connection URLs
  live in `prisma.config.ts`, not the schema: `DATABASE_URL` pooled for
  runtime, `DIRECT_URL` unpooled for migrations. The client generates to
  `generated/prisma`.
- **One database serves local and production.** There is no staging copy, of
  the database or of Resend. Anything run locally touches the real thing —
  see `EMAIL_DRY_RUN` in CLAUDE.md §6.
- Vercel Hobby. No long-running processes; cron fires once daily and only
  within its scheduled hour (±59 min). Request bodies cap at 4.5MB. Deployment
  protection blocks a function fetching its own deployment URL, so anything a
  route needs must be read off disk, not over HTTP.
- Auth: single shared password against `ADMIN_PASSWORD`, signed httpOnly
  session cookie, protecting every route except `/login`, the cron routes
  (`CRON_SECRET`), the inbound email webhook (Svix signature from Resend), and
  `/api/finances`.
- Anthropic API with tool use as the chat engine. **Sonnet 5** by default;
  an explicit `request_deep_analysis` tool re-runs the turn on **Opus 5** when
  Studio Mouse judges the problem hard. The nightly pass and the morning
  report always run on Opus.
- Resend for email, sending from `send.cleocamp.com` (subdomain — the root
  carries the company's existing SPF and must not be touched). The same
  subdomain receives: its MX record makes it a catch-all, so the inbound
  webhook filters to mailboxes actually in use.
- Mobile-first. The homepage is the primary surface and must work cleanly on a
  phone.

## 4. Data model

### Core
- **Product** — name, shopifyProductId, status, productionLeadTimeDays,
  location, createdAt
- **ProductVariant** — productId, shopifyVariantId, colorwayId, size,
  onHandQty (nullable = *unknown*, not zero), createdAt
- **Colorway** — productId, customerName, dyeHouseName, pantone, active.
  Colors have two names: customers see "Shell", the dye house calls it
  "Shrinking Violet". Studio Mouse must speak both or it will send Cleo to
  Martin with the wrong word.
- **Component** — name, vendorId, vendorSku, vendorDescription,
  unitOfMeasure (consumption), purchaseUnit, unitsPerPurchaseUnit,
  leadTimeDays, unitCostCents, reorderThreshold, onHandQty, incomingQty,
  category (MATERIAL | TRIM | HARDWARE | PACKAGING)
  - Purchase unit and consumption unit differ: fabric is consumed by the yard
    and bought by the roll (~65 yds). "Order 200 yards" is not a thing a vendor
    can sell.
- **BomLine** — productId, componentId, qtyPerUnit. Components may themselves
  have a BOM (Bateau handles are leather + rivets assembled before the bag).
- **Vendor** — name, role (COMPONENT_SUPPLIER | MANUFACTURER | DYE_HOUSE),
  contactName, contactInfo, address, orderMethod, paymentTerms, active, notes

### Movement
- **InventoryEvent** — append-only. componentId *or* productVariantId (exactly
  one), deltaQty, countedQty (absolute, required for COUNTED), type, source,
  note, createdById, chatMessageId, correctsEventId, `locationId` /
  `atVendorId` (component events only — see below), `transferGroupId`,
  createdAt
  - Types: RECEIVED, USED, COUNTED, MANUAL_ADJUST, GIFTED, WHOLESALE_SHIPPED,
    STYLIST_PULL_OUT, STYLIST_PULL_RETURN, RETURNED, CORRECTION, TRANSFER
  - `COUNTED` records what Cleo actually said ("I counted 40") in `countedQty`
    and stores the derived delta alongside. Storing only a delta loses the
    statement. For a component event, `countedQty` is absolute AT THE PLACE
    GIVEN, never a total across every place it's held.
- **`ComponentLocationStock`** — componentId, `locationId` *or* `atVendorId`
  (exactly one), qty. Added 10 Sept 2026. Most trim and hardware is bought
  per production run and ships straight to whichever vendor is cutting it,
  not the studio — Brandon: "we will rarely have button in studio, we will
  have them at various factories." Unlike fabric, this is worth counting:
  a factory can end up sitting on real surplus or running short and nobody
  would know. Materialized the same way `Component.onHandQty` itself is —
  written in the same transaction as the `InventoryEvent` that changed it,
  recomputable from the ledger alone. `onHandQty` stays the TOTAL across
  every place; this table is where. `TRANSFER` writes a matched pair (one
  negative, one positive, linked by `transferGroupId`) and leaves the total
  unchanged. Never used for MATERIAL (fabric) — that stays uncounted
  anywhere, by design, unchanged from the rule below. `Component.locationId`
  (a single location per component) was removed the same day — 26 rows, all
  pointing at "Studio", carried no real information once every non-studio
  component could be held at several vendors at once.
- **ProductionRun** / **ProductionRunLine** — productId, vendorId (the CMT),
  status, currentStage, startedAt, expectedReadyAt, receivedAt, cost.
  **Holds no inventory.** Exists for work-in-progress visibility ("where is my
  run?") and for chaining lead times.
- **ComponentOrder** — componentId, qtyOrdered, orderedAt, expectedAt,
  receivedAt, unitCostCents. `incomingQty` derives from this. A bare
  "50 arriving" with no date can't be forecast against.

### Knowledge & attention
- **ActionItem** — kind (QUESTION | TODO | GAP), entityType, entityId, title,
  detail, dueDate, createdById, assignedToId, source (CHAT | EMAIL | SYSTEM),
  resolved, resolvedAt, resolutionNote
  - Unifies "Studio Mouse needs to know X" and "a person must do Y by Z".
    Both are resolved by a human and both belong in one list.
  - **GAP** is the third kind and belongs to nobody in the studio: Studio Mouse
    could not do something it should have been able to, reported from chat with
    `entityId` pointing at the ChatMessage. It waits on a code change, so it is
    listed separately — putting it in the list of things people must do makes
    that list lie about its own length. See §6.
- **Alert** — severity, message, resolved, relatedActionItemId. System-raised
  and system-resolving; kept separate from ActionItem for that reason.
- **Note** — entityType, entityId, content, source. Where nonstandard workflow
  gets captured once Studio Mouse has asked enough to understand it.
- **Person** — name, email, role, active
- **ChatMessage** — threadId, role, content, toolCallsJson, model, createdAt
- **SalesSnapshot** — productVariantId, date, unitsSold, source
- **ForecastResult** — productId/componentId, projectedStockoutDate,
  recommendedOrderDate, note, blockedReason, computedAt
- **CalendarEvent** — forecastResultId, googleEventId, title, date, type,
  status, source. Events are forecast *input* as well as output — a pop-up in
  the window gets flagged before Cleo sizes an order.
- **FileLink** — title, url, category

All three of ActionItem, Alert, and the forecast surface in one homepage panel:
**things to tend to**. One place to look, three origins.

### Documents & orders
- **PurchaseOrder** / **PurchaseOrderLine** — the house PO, §8b. A line names
  exactly one thing: a `componentId`, a `productVariantId`, or its own
  `description` for something the catalogue does not hold yet. That third case
  is not a loophole — a purchase order is frequently how a new thing first
  exists, and requiring a catalogue row first made new colours unorderable.
  `PurchaseOrder.language` is `en`, `es` or `both`.
- **DocumentDefaults** (singleton) — the bill-to block, the standing confirm
  sentence and its Spanish counterpart, who to confirm with. This is document
  *content*, and Studio Mouse can edit it. Layout stays in the template. It was
  hardcoded until 4 Sept, which meant changing a name on a document needed a
  deploy.
- **NotificationSettings** (singleton) — every scheduled email's on/off switch.
  Same reasoning: "stop emailing me" is a thing a person says, not a deploy.
  The `forwardInbound*` columns are dead as of 11 Sept 2026 (§9); nothing reads
  or writes them and Studio Mouse can no longer set them.
- **WholesaleAccount** / **WholesaleShipment** / **WholesaleShipmentLine** —
  what went out, what was paid, what sold on consignment.
- **FinancialSnapshot** — bank and AR figures, as of a date, entered by hand
  while the books are being reconciled. Never carried forward as current.

### Email & sync
- **InboundEmail** — everything arriving at a Studio Mouse mailbox, stored raw.
  `forwardedAt` is vestigial: it guarded forwarding against Resend's retries
  until auto-forwarding was removed on 11 Sept 2026 (§9). Nothing writes it now.
- **SentEmail** — what went out, so a thread can be reconstructed from one side.
- **ShopifySyncStatus** (singleton) — when the last real sync ran, so "how
  current is this" is a timestamp rather than a claimed cadence that silently
  goes wrong the day a sync fails.
- **ChatThread** / **ChatAttachment** — conversations survive navigation, and a
  document dropped into chat is stored with the message that carried it.
- **DailyBrief** — Mouse's Corner, composed once a day and kept, so it does not
  rewrite itself on every refresh.

## 5. Forecast engine

Run nightly for every Component and every Product. The chain:

```
projected daily sales rate  (weighted toward recent weeks)
  → units needed over horizon
  → minus finished-goods on hand
  → units requiring production
  → × BOM qtyPerUnit
  → component demand
  → vs component onHandQty + incomingQty
  → component reorder date
  → + component leadTimeDays
  → + productionLeadTimeDays
  → finished-goods availability date
```

**Demand = DTC sales + WHOLESALE_SHIPPED + GIFTED.** Stylist pulls are excluded
— they leave the studio but they are not demand, and counting them as sales
over-orders.

**Do not double-count.** Components are consumed at *production* time (logged
as USED), not at sale time. Sales drive *future* production need, which drives
component demand. Deducting components from sales directly counts them twice.

**Packaging consumes per shipped order**, not per production run. Different
model, same watchdog.

**When a field is missing, do not skip silently.** Set `blockedReason` on the
ForecastResult and raise an ActionItem plus an Alert naming exactly what's
missing: "Can't forecast Cleo Tee restock — manufacturing lead time unknown."

## 6. Studio Mouse

`POST /api/chat`. Persistent thread, not a one-shot parser.

The whole catalog goes into context each turn — products, variants, colorways,
components, vendors, open items. At this scale that is a few thousand tokens,
and it beats fuzzy retrieval, which fails silently when "the pink one" doesn't
substring-match a colorway named "Rose".

Tools, as of 2026-09-11 — `lib/mouse/tools.ts` is the list that counts:

- **Catalogue** — create/update vendor, product, component, colorway;
  `create_product_variants`, `rename_variant_sizes`, `merge_colorway`,
  `merge_component`, `update_product_bom`
- **Movement** — `log_inventory_event`, `correct_inventory_event`,
  `transfer_component_stock`, `create_production_run`,
  `update_production_run`, `sync_shopify`
- **Documents** — `create_purchase_order`, `update_purchase_order`,
  `update_purchase_order_lines`, `send_purchase_order`,
  `update_document_defaults`
- **Wholesale** — `create_wholesale_account`, `log_wholesale_shipment`,
  `update_wholesale_shipment`
- **Attention & admin** — `raise_question`, `resolve_question`, `create_todo`,
  `add_note`, `create_calendar_event`, `record_financials`, `send_email`,
  `update_notification_settings`, `query_status`, `request_deep_analysis`

Behavioral rules are in `CLAUDE.md` §4 and must be stated directly in the
system prompt, as hard rules rather than preferences.

**The recurring failure is a wall, not a gap.** Repeatedly, "Studio Mouse
can't do that" turned out to be operational content or a setting hardcoded
into a template or a route — the document's bill-to block, the email
schedule, the requirement that a PO line point at an existing variant. None
were safety boundaries; each needed a deploy to change something a person
should have been able to say out loud. The line that holds is **content vs.
presentation**: what a document *says* is Mouse's to change, how it is *drawn*
is not. When a new refusal appears, check which side of that line it is on
before defending it.

**Gap reports.** Every Mouse reply in chat carries a quiet "Mouse can't do
this — tell Claude" link, filing an `ActionItem` of kind `GAP` against that
message. It stores a pointer, not a copy, so the thread is read live when the
report is opened — a correction or a second attempt that worked is often the
most useful part. They collect in their own section on `/items`, with the tool
calls Mouse actually reached for, and copy as plain text for pasting into a
session that starts cold.

**New product intake.** Creating a Product triggers a checklist; every
unanswered item becomes an ActionItem: components and quantities, manufacturer,
dye house, lead times, colorways, sizes, retail price, packaging. Studio Mouse
works through them conversationally over days, not in one interrogation.

**Vendor change.** When a manufacturer or supplier is replaced, the old lead
times, prices, and SKUs become **unknown**, not inherited. Studio Mouse asks
for the new ones and asks what happens to any run currently in flight. The old
vendor record is retained as inactive with its history intact.

## 7. Screens

The nav, in order: Home, Products, Components, Vendors, Purchase orders,
Wholesale, Finances, Inbox, To tend to.

1. `/login`
2. `/` — chat as the primary element; **Mouse's Corner**, the one-paragraph
   morning assessment; **things to tend to**; production runs and orders in
   flight; month calendar on desktop, agenda list on mobile; quick links
3. `/products` — products, variants, colorways, BOM, lead times
4. `/components` — on-hand, incoming, days of stock remaining
5. `/vendors`
6. `/purchase-orders` — every order, grouped by status, whatever its status.
   A DRAFT from yesterday is exactly as easy to find as a sent one; Home and
   Finances deliberately show only SENT and PARTIALLY_RECEIVED, so this is the
   place a draft actually lives. Individual documents at `/po/{number}`, with
   `/po/{number}/pdf` for the real file.
7. `/wholesale` — accounts, shipments, what is paid and what sold
8. `/finances` — cash position, orders on the books, payment stages
9. `/inbox` — mail that reached a Studio Mouse address
10. `/items` — open and resolved questions and todos, plus gap reports

**Not built:** `/production` and `/history` were specified on 1 Sept and never
made. Production runs surface on Home and in chat; the inventory ledger is
queryable but has no screen. The audit trail argument still stands — it is
simply still owed.

## 8. Scheduled jobs

Two crons, both guarded by `CRON_SECRET` because Vercel Cron cannot hold a
session cookie. Hobby allows one run per day each, within the scheduled hour.

**`GET /api/cron/nightly`** — 12:00 UTC. One job that fans out, in order:

1. **Pull in the world** — calendar feed, a trailing window of Shopify orders
   and counts (not the full history; it has to stay inside the 300s ceiling),
   the structured balances email, then `nightlyPass()` — one Opus pass over
   everything with the same brain the chat uses, which becomes Mouse's Corner.
   QuickBooks refreshes if connected, mainly to keep the Intuit refresh token
   from expiring after 100 days unused.
2. **Work out where things stand** — recompute every forecast.
3. **Raise what needs raising** — an Alert per newly urgent or newly blocked
   forecast, per negative on-hand quantity, and one when the cash figures go
   more than seven days stale. The stale-cash alert resolves itself when
   someone refreshes, because an alert that is always there gets ignored, and
   then a real one gets ignored with it.
4. **Calendar entries** for the dates that matter.
5. **Send what is due** — every switch here is a row in `NotificationSettings`,
   not a constant.

Each step is wrapped: one failing step must not take the whole night with it.
`?dry=1` runs everything and composes the mail but sends nothing.

**`GET /api/cron/am-report`** — 15:00 UTC, ~8am Pacific. The morning report to
Brandon and Cleo, narrated rather than a table dump.

**The daily/weekly/monthly digest is off**, and has been since 3 Sept —
superseded by Mouse's Corner and the morning report, which were more accurate.
The code is intact behind `digestEnabled` rather than deleted.

Recipients are `brandon@cleocamp.com` and `cleo@cleocamp.com`. Not team@ —
that is a group address that cannot receive external mail, so anything sent
there bounces.

Idempotent by construction — a partial unique index on unresolved Alerts, and
a DigestSend row keyed by date so repeated hits cannot double-send.

## 8b. Purchase orders — the house template

Two renderings of one document, kept in sync by hand:

- `app/po/[poNumber]/page.tsx` — the HTML page, for reading in the app
- `lib/po-pdf.tsx` — the real PDF, via `@react-pdf/renderer`, for the file a
  vendor receives

Deliberately not a screenshot of the page: that would mean a headless browser
on every download, for a document simple enough that a second direct rendering
is lighter and more reliable. **`scripts/po.mjs` is the original headless-Chrome
version and is dead** — nothing calls it.

`@react-pdf/renderer`'s base-14 font names ("Helvetica") are **not embedded**
and render as blank glyphs in real viewers. `pdftotext` extracted the text
perfectly, so the document looked correct in every check that did not rasterize
it. PT Serif is embedded from `assets/fonts/`, read off disk — `next.config.ts`
carries the `outputFileTracingIncludes` entry that gets those bytes into the
deployed function. Hyphenation is disabled; react-pdf's default split "Los
Angeles" as "Los Ange-les" in a narrow column.

The template, as agreed with Brandon:

- **Letterhead** — the Cleo wordmark in italic serif, `Cleo Couture LLC` beneath
- **Three address blocks: Vendor, Address, Bill to.** Genuinely three different
  places — fabric is delivered to the *manufacturer*, not the studio, while the
  bill goes to Cleo Couture LLC. The middle block was "Deliver to" until 4 Sept;
  renamed because on a cut-and-sew order the goods go back to the maker's own
  address, and the two blocks side by side read as a mistake rather than a fact.
- **Vendor is the registered name**, not Cleo's name for them: "EMPIRE", not
  "Antonio's", which means nothing on Antonio's own letterhead.
- **PO numbers** run sequentially from 2356.
- **Line items** carry the vendor's own style number and, on a cut-and-sew
  order, the product photo pulled from Shopify.
- **Notes are exactly what someone wrote** — nothing synthesized per line.
- **Language** — `en`, `es`, or `both` (bilingual labels), defaulting from the
  vendor's own setting. Several makers are LA cut-and-sew shops where the
  office and the floor do not read the same language. The app translates
  **chrome** — fixed labels and dates, a closed set that can be got right once.
  It does **not** translate **content** — notes, terms, units, line text — which
  is written in the right language when it is written. A machine translation of
  "50% on order, balance on delivery" that comes out subtly wrong is a real
  dispute with a real factory. Product and colourway names never translate.

**Studio Mouse sends them.** `send_purchase_order` attaches the real PDF —
a vendor has no login here, so a link is a dead end — and always copies
studio@ and brandon@, plus the vendor's standing `ccEmails`, plus anyone named
for that one send. Only when someone in the chat has said to send it.

The PDF is rendered *before* the status is written, so a failed send leaves a
draft rather than a phantom sent order — but that ordering once put "DRAFT —
NOT SENT" on the copy RichLine received as PO 2361. `renderPurchaseOrderPdf`
takes `asSent` to render the document as what it is at the moment of sending,
leaving the database write last where it belongs.

## 9. Integrations

**`lib/integrations/shopify.ts` + `shopify-sync.ts` — live, and writing.**
Admin GraphQL (2026-07) under a client-credentials grant. Shopify is the
permanent master for finished goods: `writeEvent` pushes to Shopify *before*
committing locally, and if Shopify rejects the write nothing changes here
either. Adjustments are delta-based at inventoryItem + location granularity,
never variant, and `changeFromQuantity` is required — a compare-and-swap that
fails rather than clobbering a count someone else moved. An `@idempotent`
directive keyed on the event id makes a retry safe.

Note the linkage: the sync populates `shopifyVariantId` per **variant** and has
never set `Product.shopifyProductId`. A guard that tested the product-level
field therefore never fired on any of the 20 products. Read Shopify liveness
off the variants.

**`lib/integrations/calendar.ts`** — reads the shared feed nightly.

**`lib/integrations/quickbooks.ts`** — built, still unconnected. Intuit's
refresh token rotates on every use and dies after 100 days unused, so the
nightly job refreshes it whether or not anyone wants figures. The token lives
in `QuickBooksConnection`, never in an env var; only `QBO_CLIENT_ID`,
`QBO_CLIENT_SECRET` and `QBO_REDIRECT_URI` are env, and as of 12 Sept 2026 all
three are empty placeholders, so `isConfigured()` is false and the cron skips
the step. `totalExpenses()` and `totalIncome()` here never trust QuickBooks'
own summary rows — see CLAUDE.md §6 on the $0.00 expenses bug — and return the
figure, the method that produced it, and any disagreement between methods.
Explicitly **not** an inventory trigger. See §10.

**Inbound email — live.** `POST /api/inbound/email`, verified by Svix
signature, is public by necessity. Mail is stored and **nothing is ever
applied**: Studio Mouse reads it later and raises *proposals* a human confirms,
because anyone who can email the company must not be able to write to
inventory. See CLAUDE.md §4.

**Auto-forwarding — built 9 Sept, removed 11 Sept 2026.** Arriving mail used to
be copied on to Cleo and Brandon, because some people reply to Mouse and forget
to cc. It was narrowed three times — machine senders, auto-replies, our own
address, then anyone already on the original To/Cc, then down to Brandon alone —
and every round still produced forwards he did not want. The last batch went out
working *exactly as specified*: mail from Nicki, who is neither Brandon nor Cleo
and had not cc'd either, so every suppression rule correctly declined to fire.
The filter was never the bug. The premise was: wanting a copy of everything is
not the same as wanting to be told what changed, and the nightly pass and the
Inbox already do the second one. `lib/inbound-forward.ts` and
`lib/inbound-attachments.ts` are deleted, the settings toggle is gone with them
so Mouse cannot switch it back on, and `InboundEmail.forwardedAt` survives only
as a column nothing writes. Bringing it back is a build decision, not a setting.

Mail still arrives, is still stored, and is still read — by Mouse overnight and
by anyone on the Inbox page. What stopped is the uninvited copy.

**Not built: Google Drive.** Archiving sent POs to the shared drive needs a
Google Cloud service account and is still owed.

## 10. Excluded, and why

- **QuickBooks as an automatic write to the ledger.** The books were
  mid-calibration through Aug 2026 — Shopify reported $67,744.80 of August
  sales against a QuickBooks P&L of $0.00 — and figures were excluded outright.
  Brandon reported them balanced on 12 Sept 2026, and a daily co-work task now
  pulls them and emails Studio Mouse. They still do not write themselves in:
  inbound email is data, never instructions (CLAUDE.md §4), so a pulled figure
  arrives as a proposal a person confirms via `record_financials`, always with
  the date it is as of and never carried forward as current.
  - The app's own Intuit connection remains unconfigured, so the nightly
    figures step still skips. Two routes, one live: the claude.ai connector
    reaches Claude Code sessions and drives the daily task; the app's OAuth
    needs its three env values and one visit to `/api/quickbooks/connect`.
  - The bank balances Cleo Camp actually watches are on QuickBooks' *banking*
    screen, which no API exposes — only ledger balances, which are the ones
    adrift. This is why the manual path is not simply laziness.
- **Work-in-progress inventory.** Nothing counts until it lands in the studio.
- **Automatic order sizing.** Cleo decides quantities.
- **Quantified event demand lift.** Flag the event; don't predict its sales.

## 11. Backlog

See `docs/seed-facts.md` for the 1 Sept list, and `/items` for the live one.
Headline items as of 2026-09-10:

- **Google Drive archiving** — a service account, then sent POs land in the
  shared drive automatically.
- **Wholesale invoices** — the same treatment POs got: generated in chat and
  from a button on the Wholesale page.
- **Shopify Payments scopes** — `read_shopify_payments_accounts` and
  `read_shopify_payments_payouts` would show money in flight from Shopify.
  Brandon has to add them; nobody else can.
- **Bank balances without a manual step** — Mercury would be an API key;
  Chase or Relay means Plaid or Teller.
- **An inventory ledger screen** — §7, specified and never built.
- **Vercel Pro**, and the Vercel/Neon region mismatch (functions US East,
  database us-west-2 — batch queries rather than chaining them).
- **Rotate the Shopify client secret**, printed in terminal output in an
  earlier session.

## 12. Blocking unknowns

Seeded as ActionItems rather than guessed. Still open as of 2026-09-10:

- **Lead times, nearly everywhere.** RichLine, Staples and Antonio's all have
  none on file, and only 5 of 22 products carry a `productionLeadTimeDays`.
  This is the single biggest hole: without it a forecast cannot name a date,
  and roughly a dozen products sit permanently blocked with "no production
  lead time, so there is no date by which to order."
- **Antonio's per-unit price and turnaround** — in final sampling.
- **Staples pricing** — sampling charges quoted, production prices not
  confirmed. A PO line with no confirmed price prints as "—", never a guess.
- **Six Shopify Cleo Tee variants** (Black and White, sizes 1–3) are not linked
  to anything here, all at qty 0. Either a retired colourway or counts reaching
  nothing.
- Cleo's outstanding intake answers — see the questions document in Drive.

**Resolved since 1 Sept:** RichLine's fine rib is style 1137 at $3.15/yd.
Antonio's legal name is EMPIRE; Staples LA USA is Staples.
