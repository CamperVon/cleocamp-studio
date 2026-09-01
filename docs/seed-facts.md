# Cleo Camp Studio — confirmed facts for seeding

Running record of answers as they arrive. Everything here is confirmed from a
primary source (invoice, screenshot, or a direct answer from Brandon/Cleo).
Unconfirmed items stay in the intake doc and get seeded as OpenQuestion rows.

---

## Components

### Fine rib cotton  — CONFIRMED 2026-09-01
Source: California Textile Group invoice #29199 (payment due Jul 20 2026)

| Field | Value |
|---|---|
| Vendor | California Textile Group |
| Vendor style # | `RIB1000` |
| Vendor description | 1X1 BABY RIB, 100% COMBED COTTON |
| Color code | PFD (Prepared For Dyeing) |
| Price | **$2.80 / yard** |
| Purchase unit | Roll (~65 yds — 1,034 yds across 16 rolls on this invoice) |
| Consumption unit | Yard (1.50 yds per short-sleeve tee) |
| Sales rep | Aimee Alparce |
| Payment terms | COD |

- Settles the $2.80 vs $2.60 conflict. **$2.80 is correct**; the $2.60 in the
  loan model was an assumption.
- 1,034 yds ≈ 689 short-sleeve tees at 1.50 yds each.
- NOTE: Brandon has said they are moving to a new fabric vendor. This is the
  base price until that happens. When it does, style #, price, lead time, and
  roll size all reset and must be re-asked — do not carry these forward.

---

## Open items this raised

- Fabric lead time still unknown (not on the invoice). Stays in intake doc.
- Roll yardage varies; ~65 is an average from one invoice, not a fixed size.
- Dye lot `CAG27042F` recorded but not modeled in Phase 0.

---

# Update — 2026-09-01 (from Brandon)

## Vendor changes in flight

### Fabric: California Textile Group → RichLine
- New fabric vendor: **RichLine**, contact **Michael Pollack**
- Covers: regular Cleo Tee **and** new Cosmo Stripe Tee
- CTG's $2.80/yd RIB1000 remains the base price until the switch completes
- ?? Does RichLine replace CTG entirely, or only for these two products?
- ?? Effective date of switch unknown

### Cleo Tee manufacturer: Fashion Garcia → Antonio's
- Old: **Fashion Garcia** (Jeremias, 8636 Otis St, South Gate) — move to INACTIVE
- New: **Antonio's**, contact **Antonio**
- ?? Full business name, address, turnaround time, per-unit price all unknown
- Per the design rule: old lead times do NOT carry forward. All reset to unknown.

## Components

### Fine rib cotton (RIB1000, PFD) — CTG
- Lead time: **in stock** (no wait)
- ?? "In stock" where — at CTG, or in the studio? If at CTG, realistic
  turnaround from order to hand?

### Red rayon — NEW
- For: Cosmo Stripe Tee (Cosmopolitan magazine collab)
- Lead time: **3 weeks from PO**
- Price: **$4.95** (?? per yard — assumed, not stated)
- ?? Vendor assumed **RichLine** from context — CONFIRM
- Also used for: Cleo Underwear (from leftover yardage on the same buy)

## Products

### Cosmo Stripe Tee — about to start manufacturing
- Cosmopolitan magazine collaboration
- Same pattern and workflow as Cleo Tee; specialty fabric is the only change
- Fabric: red rayon
- Manufacturer: Antonio's (assumed — same as Cleo Tee)
- MODELING CALL: separate Product, not a Cleo Tee variant. Different fabric,
  different BOM, different cost.

### Long Sleeve Cleo Tee — in development
- Same tee, long sleeves
- Same manufacturer and fabric as regular Cleo Tee + Cosmo tee
- Loan model has 1.80 yds/unit vs 1.50 for short sleeve
- MODELING CALL: separate Product (different yardage = different BOM)

### Cleo Underwear — in development
- Same manufacturer as Cleo Tee (Antonio's)
- Starting with the **rayon**, matching the Cosmo tee
- First run: **70–100 units**
- Made from **leftover fabric** off the Cosmo tee yardage (remnant usage —
  not modeled in Phase 0, but means its fabric cost is effectively absorbed)
- Loan model reference: $5.00/pair C&S incl. elastic, ~5 pairs per yard

### Scoop Neck Dress — currently in sampling
- Manufacturer: **Staples**
- ?? Full name, contact, lead time, materials all unknown

### Cleo Sweater (unnamed) — in development
- All details TBD

### Red Bag — in development
- Same manufacturer as Cleo Bag = **Lorena and Santos**
- All other details TBD

### Story Dress — reorder in progress
- Re-ordering more quantity with same manufacturer (**Novelty Fashion**, Rolando)
- Date not yet confirmed by the manufacturer
- → good first test of a PENDING ProductionRun with no confirmed date

## People
- **Nicki** — new Project Manager for manufacturing (internal)
- Existing: Cleo (founder), Brandon, Jane

## Requirements added this round
1. Cleo speaks naturally; SM interprets and asks when unclear. No forms.
2. TODOs with due dates, created by anyone (Cleo, Brandon, staff), tracked,
   pinged a few days ahead and surfaced in digests.
3. SM should write changes back to the Google Drive product docs — old info
   preserved in an "Inactive" section at the bottom rather than deleted.

---

# Resolved — 2026-09-01 (second pass)

## RichLine — now the sole fabric vendor for the tee/underwear program
- Contact: **Michael Pollack**
- **Replaces California Textile Group entirely** for Cleo Tee + Underwear
  (and therefore Long Sleeve Tee and Cosmo Stripe Tee)
- Supplies BOTH fabrics:
  - **Fine rib** — *in stock at RichLine*, so **no lead time** once a PO is placed
  - **Red rayon** — **$4.95** (current price, may change), **3 weeks from PO**

### !! Consequence Brandon may not have registered
The $2.80/yd on the CTG invoice is **California Textile Group's** price for
their style RIB1000. CTG is being fully replaced. That number is therefore a
legacy figure and should NOT be seeded as the live fine-rib cost.

STILL NEEDED from RichLine:
- Their price per yard for the fine rib
- Their style number / spec (is it the same 1x1 baby rib, 100% combed cotton, PFD?)
- Their roll size (CTG rolls averaged ~65 yds; RichLine's may differ)

CTG record is retained as INACTIVE with the $2.80 / RIB1000 history intact.

## Antonio's (new Cleo Tee manufacturer)
- In **final stage of sampling**
- Per-unit price owed, expected soon
- Business name / address / contact detail: Brandon standing by

## Confirmed decisions
- **The app is the master.** Google Drive product docs become a generated view.
  Superseded info moves to an Inactive section at the bottom, never deleted.

---

# Backlog — Phase 2 / 2.0

1. **Google OAuth for the app** — unlocks three things at once:
   - Studio Mouse writing back to the Drive product docs
   - Google Calendar two-way sync
   - Live Drive folder browsing for the homepage links panel
2. **Email monitoring** — studio@, wholesale@, billing@, brandon@, jane@,
   support@. Extracts operational facts (delays, price changes, ship dates)
   and surfaces them as proposals to confirm, never direct writes.
3. **QuickBooks reconciliation** — blocked until the books agree with Shopify.
4. **Learning demand from history** rather than being told.
5. **3PL / multi-location** — 2027.

## Backlog additions — 2026-09-01
6. **Move Claude API billing from BC org to a Cleo org.** Currently the
   Anthropic key would sit under Brandon's existing org. Cleo Camp should have
   its own org so usage and billing are attributable and separable — same
   isolation principle as the Neon project and Vercel project.
7. **Upgrade Vercel to Pro** ($20/mo) — gives reliable cron firing at a set
   time rather than anywhere within the hour, higher function duration limits,
   and function region selection.
8. **Resolve Vercel/Neon region mismatch.** Neon is us-west-2; Vercel Hobby
   runs functions in US East by default and does not expose region selection.
   Fix is either (a) upgrade to Pro and set functions to US West, or
   (b) recreate the Neon project in US East. Cheapest before there is data.
