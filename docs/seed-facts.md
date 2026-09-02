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

---

# Manufacturing costs — CONFIRMED 2026-09-01
Source: Fashion Garcia Inc invoices 324 and 325, both dated 6/26/2026

Fashion Garcia Inc — 8616 Otis Ave, 2nd Floor, South Gate CA 90280
Tel (323) 487-5054 / Cell (323) 541-2200
NOTE: bible lists "8636 Otis St" — address differs. Low priority (vendor is
being replaced) but the bible record is wrong somewhere.

## Invoice 324 — Cut #12, 112 units
| Line | Unit price | Total |
|---|---|---|
| Cleo T Shirt (sew) | $9.25 / unit | $1,036.00 |
| Cutting | $165.00 flat | $165.00 |
| Transport to/from dye house | $40.00 × 2 | $80.00 |
| **Total** | | **$1,281.00** |

Effective all-in: **$11.44 / unit**

## Invoice 325 — Cut #13, 1,411 units
| Line | Unit price | Total |
|---|---|---|
| Sewing | $8.50 / unit | $11,993.50 |
| Cutting | $0.35 / unit | $493.85 |
| Pick up rolls | $40.00 flat | $40.00 |
| **Total** | | **$12,527.35** |

Effective all-in: **$8.88 / unit**

## What this establishes

1. **A real volume break exists.** Sew+cut is $9.25 + flat cutting on a small
   run, versus $8.85/unit combined at 1,411 units.
2. **Small runs cost ~29% more per unit.** $11.44 vs $8.88. Most of the gap is
   the flat $165 cutting charge amortized over 112 units ($1.47/unit) instead
   of 1,411 ($0.35/unit). This is quantified evidence for the order-sizing
   advisory — Studio Mouse can now say *why* a small run is expensive, from
   real invoices rather than a guess.
3. **Production runs carry flat costs, not just per-unit costs.** Cutting
   setup ($165) and transport ($40 each leg, dye house and fabric pickup).
   SCHEMA IMPLICATION: `ProductionRun` needs flat/setup cost lines separate
   from per-unit costs, or small-run economics stay invisible.
4. Run sizes vary widely: 112 and 1,411 units in the same month. Partially
   answers intake question 27.
5. The loan model's $9.25/tee C&S is the **small-run** rate. At volume the
   real figure is $8.85, so that model is slightly conservative.
6. Runs are identified by **Cut # / PO** (#12, #13). Use as ProductionRun ref.

## Antonio's = EMPIRE SEWING INC
- Legal name: **Empire Sewing Inc**, contact Antonio
- **Matches Fashion Garcia's current pricing**
- **Shorter turnaround** than Fashion Garcia — figure pending
- ?? Does "match current pricing" mean the full structure including the volume
   break and flat cutting charge, or just the headline per-unit rate?
- ?? Address, phone, exact turnaround still pending

---

# RichLine pricing — CONFIRMED 2026-09-01
Source: Michael Pollack, RichLine, direct quote

| Fabric | Style | Spec | Price | Used for |
|---|---|---|---|---|
| Rib | **1137** | — | **$3.15 / yd** (volume price) | Cleo Tee, Long Sleeve Tee |
| Red yarn dye lurex stripe | **D1463** | 58–60" wide, 220 gsm | **$4.95 / yd** | Cosmo Stripe Tee, Underwear |

## Impact

- Rib goes from CTG's $2.80 → RichLine's **$3.15**, a **12.5% increase**
  (+$0.35/yd). At 1.50 yds/tee that is **+$0.53 per tee**.
- Fabric cost per Cleo Tee: 1.50 × $3.15 = **$4.73** (was $4.20).
- $3.15 is already Michael's volume price — "the best I can do."

### Estimated all-in unit cost, Cleo Tee at volume
| Line | Cost |
|---|---|
| Fabric (1.50 yd × $3.15) | $4.73 |
| Sew + cut (Empire matching FG volume rate) | $8.85 |
| Buttons + tag | $1.00–1.36 (unresolved — see intake Q17) |
| Flat costs amortized at volume | ~$0.05 |
| **Total** | **~$14.65–15.00** |

Retail $88.

## Open points

- Brandon described the Cosmo fabric as "red rayon"; Michael calls it
  "red yarn dye lurex stripe" (lurex = metallic thread). Likely the same
  fabric described two ways, but the fiber content is not actually confirmed.
- **Yards per Cosmo tee is NOT established.** The 1.50 yd figure was measured
  on the rib. D1463 is 58–60" wide at 220 gsm; if that differs from the rib's
  width, yield per yard differs and 1.50 will be wrong. Needs confirming before
  any Cosmo tee forecast.
- CTG record retained as INACTIVE with $2.80 / RIB1000 history.

---

# Company & purchasing details — CONFIRMED 2026-09-01

- **Legal entity:** Cleo Couture LLC (matches the QuickBooks P&L header)
- **Studio / ship-to address:** 1667 North Main St, Los Angeles, CA 90012
  (city/state inferred from the 90012 ZIP — confirm if wrong)
- **PO numbering:** starts at **2356**, increments by 1
- **PO delivery, Phase 0:** generate a PDF; Brandon sends it himself.

## Backlog addition
9. **Studio Mouse sends POs directly.** After Phase 0, SM may email a PO to the
   vendor — but only after an explicit confirmation step, and it must always
   CC Cleo and Brandon. No PO leaves the building unconfirmed.

## RichLine roll size — CONFIRMED 2026-09-01
Michael Pollack: rolls vary **70–80 yards**.

- Recorded as 75 yd as the planning midpoint, with the variance noted.
- Consequence: you order **rolls**, not yards, and the delivered yardage lands
  in a roughly ±7% band. Studio Mouse must express reorders in rolls and state
  the resulting range rather than promising an exact figure.
- ?? Confirmed for the rib (1137). Whether D1463 rolls run the same is not
  stated — worth asking, since the Cosmo order is being placed now.

---

# Yardage conflict — UNRESOLVED 2026-09-01

Brandon: **903 yards of cotton → roughly 1,296 tees** = **0.70 yd/tee**.
Loan model (marked "confirmed"): **1.50 yd/tee**.

These differ by a factor of 2.15 and cannot both be right.

| Yards per tee | 1,000 yd ordered yields |
|---|---|
| 1.50 (current BOM) | ~667 tees |
| 0.70 (Brandon's figure) | ~1,435 tees |

Real production output normally beats a spreadsheet estimate, and 0.70 yd is
plausible for a fitted women's rib tee on wide goods. But the BOM has NOT been
changed — this drives fabric cost, reorder quantity and margin on every tee,
and is exactly the kind of number that must not be guessed at.

Also recorded: Empire Sewing hours 7:30am–4pm, Mon–Fri (now on the PO delivery
block). Phone number still outstanding.

## RESOLVED — yards per tee is 0.70

Source: **the manufacturer**, off a real run — 903 yards yielded roughly
1,296 tees. Supersedes the loan model's 1.50, which was an estimate.

| | 1.50 (old estimate) | 0.70 (actual) |
|---|---|---|
| Fabric per Cleo Tee | $4.73 | **$2.21** |
| 1,000 yd of rib yields | ~667 tees | **~1,435 tees** |
| Fabric per Cosmo Tee | $7.43 | **$3.46** |

### Revised Cleo Tee unit cost, at volume
| Line | Cost |
|---|---|
| Fabric (0.70 yd x $3.15) | $2.21 |
| Sew + cut | $8.85 |
| Buttons + tag | $1.00–1.36 |
| Flat costs amortized | ~$0.05 |
| **Total** | **~$12.11–12.47** |

Retail $88 — roughly an 86% gross margin.

**The loan model overstated tee fabric cost by more than double.** Since that
model underpins the $191,556 ask, its production-cost line is worth revisiting.

Long sleeve yardage set to UNKNOWN: the loan model's 1.80 came from the same
source that put short sleeve at 1.50, so neither its absolute figure nor its
1.2x ratio can be trusted.

## Backlog addition
10. **Turn inventory writing back on** (`INVENTORY_WRITES=on`) once the studio
    count is finished and reconciled with Shopify. While off, Studio Mouse
    records movements it is told about as todos rather than applying them, so
    nothing is lost — those todos need working through when writing resumes.
11. **Shopify write-through.** Chat-logged movements currently update only the
    local number, which the next sync overwrites. `write_inventory` is granted
    and the location id is recorded; this closes the loop.

## Backlog addition
12. **QuickBooks invoicing.** Read access ships first (balances, receivables,
    payables, revenue). Writing invoices needs the same OAuth connection plus a
    confirmation step — Cleo ships wholesale, Studio Mouse drafts the invoice in
    QuickBooks, a human approves before it sends.
