# Cleo Camp style number system

Reference doc. Since 16 Oct 2026 the app holds the live data: every style, its
number and every variant's SKU. `crosswalk-2026-10-16.csv` lists what each old
number and SKU became. The other CSVs and the workbook in this folder are the
8 Oct 2026 system and are kept as history only.

## Format

- **Style number** = 3 letters + 3 digits. Example: **TCO101**.
  - Letter 1: the category (table below).
  - Letters 2–3: the product, from its name (CO = Cleo, CC = Cleo Cosmo). A
    person chooses them; Mouse may suggest.
  - Digit 1: the line. **1 = women's** (everything today), **5 = men's**,
    **7 = unisex** (reserved).
  - Digits 2–3: the version, 01 first. It only goes up for a redesign customers
    would see as a different version (new neckline, new length). Never for a
    new colour, never for a pattern revision.
- **SKU** = STYLE-COLOUR-SIZE: `TCO101-BLK-01`. Colour and size codes did not
  change in the re-key.
- Style regex: `^[A-Z]{3}[157]\d{2}$`
- SKU regex: `^[A-Z]{3}[157]\d{2}-[A-Z]{3}-(\d{2}|XS|SM|MD|LG|XL|PT|OS)$`

Read out loud: **TCO101-BLK-01 = Tee, Cleo Original, women's, first version,
Black, size 1.**

## Categories (letter 1)

| Letter | Category |
|---|---|
| T | Tees |
| U | Tops (blouses, shirts): reserved |
| S | Sweaters |
| B | Bottoms (pants and skirts) |
| D | Dresses |
| H | Handbags (all bags, the Bateaus included) |
| A | Accessories |
| I | Intimates |
| O | Other |
| X | Parts and components |
| J | Jackets: reserved |

## Rules

1. Never reuse a style number, retired ones and the old TP/BG/AC/DR/BT/IN/OT/PT
   codes included. The app keeps every retired number (`RetiredStyleNumber`)
   and refuses one that has been used.
2. A style is a pattern plus its construction. Same pattern and construction,
   different colour or material: a colourway. Different construction or cost
   sheet (an extra lining): a new style. Cleo Bag Olive is a colourway of
   HCB101; Cleo Bag Denim, double-lined, is its own style, HCD101.
3. A collaboration gets its own style number (TCW101 = Cleo Tee Wilde's).
4. Season and year are never in the code.
5. Letters, digits, and hyphens between SKU parts only. No hyphen inside a
   style number.
6. A new style or code is PROPOSED until Brandon or Cleo confirm it. If it is
   unclear whether something is a new style or a colourway, ask.

## Pattern labels

A style can have more than one physical pattern (the Cleo Tee has two). Each
is labelled `STYLE-P#` (TCO101-P1, TCO101-P2) and lives only on patterns and
purchase-order lines. A pattern label is never part of a SKU, a variant or
anything sent to Shopify.

## Bateau kits

A handle (ABH101) fits both bag sizes. The Bateau Bag (HBT101) is body XBT101
+ handle ABH101 in the same colour; the Petite Bateau (HPB101) is body XPB101 +
handle ABH101. The bag sells with its body and handle, and the handle alone.
Availability is limited by the lower of the body and its same-colour handle.

## The 16 Oct 2026 re-key

Every 8 Oct number moved to the new system: TP101 → TCO101 and so on (the full
list is the crosswalk, and the Old style numbers page in the app). Each
variant keeps its original legacy SKU (`sku`, e.g. CCSS25COT-BLK01) and its
8 Oct SKU (`previousSku`, e.g. TP101-BLK-01); search finds the product by any
of the three. Purchase orders already sent keep the codes they went out with;
drafts pick up the new ones. Dolce lost its number and is unnumbered until
decided. The duplicate "Red Bag" and "Hair Tie" records were merged into the
Bean Bag and the Flower Hair Tie. Applied by `scripts/rekey-styles.ts` from the
plan in `lib/style-rekey.ts`.

## History: the 8 Oct 2026 system

Two-letter category + three digits (TP101), SKU regex
`^[A-Z]{2}\d{3}-[A-Z]{3}-(\d{2}|XS|SM|MD|LG|XL|PT|OS)$`. Categories TP tops,
DR dresses, BT bottoms, BG bags, AC accessories, PT parts, IN intimates, OT
other. Retired on 16 Oct 2026; its numbers are never reused.
