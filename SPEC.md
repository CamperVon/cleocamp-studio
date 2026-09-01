# Cleo Camp Studio Admin — specification

Phase 0. Written 2026-09-01. Every decision below was made deliberately;
where the reasoning matters, it is recorded, because this gets picked up cold
in later phases.

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
- Products: Cleo Tee (multiple colorways), You Dress, Story Dress, Cleo Bag
  (leather and denim), Bateau Bag, Petite Bateau Bag, Bean Bag, Cachet, Olive
  Bag. Little Sister is sunsetted.
- In development: Cosmo Stripe Tee (Cosmopolitan collab), Long Sleeve Cleo Tee,
  Cleo Underwear, Scoop Neck Dress, a sweater, a red bag.

See `docs/seed-facts.md` for confirmed vendor, price, and product data.

## 3. Stack

- Next.js (current stable), App Router, TypeScript, Tailwind
- Prisma against Neon Postgres. `DATABASE_URL` pooled, `DIRECT_URL` unpooled
  for migrations.
- Vercel Hobby. No long-running processes. Cron fires once daily, and only
  within its scheduled hour — see backlog item on upgrading to Pro.
- Auth: single shared password against `ADMIN_PASSWORD`, signed httpOnly
  session cookie, protecting every route except `/login` **and the cron route**,
  which is protected by `CRON_SECRET` instead — Vercel Cron cannot hold a
  session.
- Anthropic API with tool use as the chat engine. **Sonnet 5** by default;
  an explicit `request_deep_analysis` tool re-runs the turn on **Opus 5** when
  Studio Mouse judges the problem hard. Digests always run on Opus.
- Resend for email, sending from `send.cleocamp.com` (subdomain — the root
  carries the company's existing SPF and must not be touched).
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
  note, createdById, chatMessageId, correctsEventId, createdAt
  - Types: RECEIVED, USED, COUNTED, MANUAL_ADJUST, GIFTED, WHOLESALE_SHIPPED,
    STYLIST_PULL_OUT, STYLIST_PULL_RETURN, RETURNED, CORRECTION
  - `COUNTED` records what Cleo actually said ("I counted 40") in `countedQty`
    and stores the derived delta alongside. Storing only a delta loses the
    statement.
- **ProductionRun** / **ProductionRunLine** — productId, vendorId (the CMT),
  status, currentStage, startedAt, expectedReadyAt, receivedAt, cost.
  **Holds no inventory.** Exists for work-in-progress visibility ("where is my
  run?") and for chaining lead times.
- **ComponentOrder** — componentId, qtyOrdered, orderedAt, expectedAt,
  receivedAt, unitCostCents. `incomingQty` derives from this. A bare
  "50 arriving" with no date can't be forecast against.

### Knowledge & attention
- **ActionItem** — kind (QUESTION | TODO), entityType, entityId, title,
  detail, dueDate, createdById, assignedToId, source (CHAT | EMAIL | SYSTEM),
  resolved, resolvedAt, resolutionNote
  - Unifies "Studio Mouse needs to know X" and "a person must do Y by Z".
    Both are resolved by a human and both belong in one list.
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

Tools: create/update for vendor, product, variant, colorway, component;
upsert_bom_line; log_inventory_event; correct_inventory_event; add_note;
raise_action_item; resolve_action_item; create_todo; start_production_run;
update_production_run; log_component_order; query_status;
request_deep_analysis.

Behavioral rules are in `CLAUDE.md` §4 and must be stated directly in the
system prompt, as hard rules rather than preferences.

**New product intake.** Creating a Product triggers a checklist; every
unanswered item becomes an ActionItem: components and quantities, manufacturer,
dye house, lead times, colorways, sizes, retail price, packaging. Studio Mouse
works through them conversationally over days, not in one interrogation.

**Vendor change.** When a manufacturer or supplier is replaced, the old lead
times, prices, and SKUs become **unknown**, not inherited. Studio Mouse asks
for the new ones and asks what happens to any run currently in flight. The old
vendor record is retained as inactive with its history intact.

## 7. Screens

1. `/login`
2. `/` — chat as the primary element; **things to tend to** panel; an
   expandable count of everything, editable in place (every edit writes a
   COUNTED event, never an overwrite); month calendar on desktop, agenda list
   on mobile; quick links
3. `/products` — products, variants, colorways, BOM, lead times
4. `/components` — on-hand, incoming, days of stock remaining
5. `/vendors`
6. `/production` — runs in flight and their stage
7. `/items` — all open and resolved questions and todos
8. `/history` — the inventory event ledger. The audit trail is useless if
   nobody can see it.

## 8. Nightly cron

`GET /api/cron/nightly`, guarded by `CRON_SECRET`. **One daily job that fans
out** — daily digest always, weekly on Mondays, monthly on the 1st. Hobby
limits daily cron count, and this keeps the three cadences consistent with each
other by construction.

Steps: recompute forecasts → raise alerts for newly urgent items → check for
negative quantities → upsert calendar events → compose and send the digest.

The digest is **narrated, not a table dump**: "Pink Cleo Tee is projected to
sell out in about four weeks. Buttons have a two-week lead time, so order by
Wednesday." Recipients: `team@cleocamp.com`.

Idempotent by construction — a partial unique index on unresolved Alerts, and
a DigestSend row keyed by date so repeated hits cannot double-send.

## 8b. Purchase orders — the house template

`scripts/po.mjs` renders a PO spec to HTML and prints it with headless Chrome.
Studio Mouse generates POs through this same code path, so the layout and the
arithmetic live in one place rather than in a template someone retypes.

The template, as agreed with Brandon:

- **Letterhead** — the Cleo wordmark in italic serif, `Cleo Couture LLC` beneath
- **Three address blocks: Vendor, Deliver to, Bill to.** These are genuinely
  three different places. Fabric is delivered to the *manufacturer*, not the
  studio — RichLine ships straight to Empire Sewing — while the bill goes to
  Cleo Couture LLC at 1667 North Main St.
- **PO numbers** run sequentially from 2356.
- **Line items** carry the vendor's own style number, because that is what the
  vendor recognises. "Style 1137 — Rib", not "fine rib cotton".
- **Notes** state what needs confirming rather than assuming it: the quoted
  price, the lead time, and the roll count where a yardage will not divide
  evenly into whole rolls.
- **Contact** — Brandon Camp · brandon@cleocamp.com · 310-622-3898

Phase 0 generates a PDF that Brandon sends. Studio Mouse sending it directly is
on the backlog, and when it lands it requires an explicit confirmation step and
always copies Cleo and Brandon.

## 9. Integrations — seams only in Phase 0

- `lib/integrations/shopify.ts` — `fetchRecentOrders`, `adjustInventory`,
  `fetchVariants`. Note that Shopify adjusts at inventoryItem + location
  granularity, not variant; shape the seam accordingly.
- `lib/integrations/google-calendar.ts` — push and pull.
- `lib/integrations/quickbooks.ts` — Phase 2 reconciliation only. Explicitly
  **not** an inventory trigger.
- `lib/integrations/email.ts` — Phase 2 inbox monitoring.

## 10. Excluded, and why

- **QuickBooks, entirely.** As of Aug 2026 the books are mid-calibration with a
  new bookkeeper. Shopify reports $67,744.80 of August sales; the QuickBooks
  P&L reports $0.00 for the same month, and carries a -$31,068.55 software
  expense reclassification. Half-calibrated data that looks authoritative is
  worse than no data. Revisit when the books reconcile with Shopify.
- **Work-in-progress inventory.** Nothing counts until it lands in the studio.
- **Automatic order sizing.** Cleo decides quantities.
- **Quantified event demand lift.** Flag the event; don't predict its sales.

## 11. Backlog

See `docs/seed-facts.md` for the live list. Headline items: Google OAuth
(unlocks Drive write-back, Calendar sync, and live Drive links in one piece of
work), email monitoring across six inboxes, QuickBooks reconciliation, Vercel
Pro, and resolving the Vercel/Neon region mismatch.

## 12. Blocking unknowns

Seeded as ActionItems rather than guessed:

- **RichLine's fine rib price, style number, and roll size.** RichLine replaces
  California Textile Group entirely for the tee and underwear program. The
  $2.80/yd on file is CTG's price for CTG's style RIB1000 and must not be
  carried forward.
- **Antonio's per-unit price and turnaround** — in final sampling.
- **Lead times generally.** Not one appears anywhere in the source documents.
- Cleo's outstanding intake answers — see the questions document in Drive.
