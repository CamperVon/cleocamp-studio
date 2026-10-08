# Cleo Camp style number system

Reference doc. Keep it in the repo (docs/style-system.md). The data lives in styles.csv, skus.csv, codes.csv and old_to_new.csv. The workbook cleo-camp-style-number-system.xlsx is the human-readable version of the same data.

Status as of Oct 8, 2026: this is the plan. Shopify and every PO already sent still use the old codes until BC confirms the switch.

## Format

- **Style number** = 2-letter category + 3-digit sequence, starting at 101 in each category. Example: TP101.
- **SKU** = STYLE-COLORWAY-SIZE. Example: TP101-BLK-01.
- SKU regex: `^[A-Z]{2}\d{3}-[A-Z]{3}-(\d{2}|XS|SM|MD|LG|XL|PT|OS)$`
- A style is a pattern or design. New color or size keeps the style number. New pattern gets a new number.

## Rules

1. Never reuse a number, including retired and discontinued ones.
2. Season and year are fields, not part of the code.
3. Letters, digits and hyphens only.
4. Colorway and size codes come from codes.csv. A new code is a proposal until BC or Cleo confirms it.
5. If it's unclear whether something is a new pattern or a new colorway, ask. Don't guess.

## Categories

TP tops, DR dresses, BT bottoms, BG bags, AC accessories, PT parts and components, IN intimates, OT other.

## Styles

See styles.csv for the full list. Summary:

| Style | Product | Note |
|---|---|---|
| TP101 | Cleo Tee | Nine colorways, sizes 01-03. Shopify spreads them across 8 product pages. |
| TP102 | Cosmo Tee | Mouse calls it Cosmo Stripe Tee. |
| DR101 | You Dress | |
| DR102 | Story Dress | Sizes 00-03. |
| BT101 | 5to7 Skirt | XS-XL, Pink and Purple. Not in Shopify yet. |
| BG101 | Cleo Bag | All colors one style. Mouse tracks five products, each a colorway here. |
| BG102 | Little Sister | |
| BG103 | Bateau Bag | Kit: PT101 body + AC102 handle, same color. |
| BG104 | Petite Bateau Bag | Kit: PT102 body + AC102 handle, same color. |
| BG105 | Bean Bag | Petite and Medium are sizes. Red Petite (RED-PT) is sold live only, not in Shopify. Mouse's "Red Bag" is this product. |
| BG106 | Cachet | Color code FLG is a placeholder. |
| AC101 | Boy Belt | |
| AC102 | Bateau Handle | Fits both Bateau sizes. Sold alone and in the kits. |
| AC103 | Flower Hair Tie | Mouse's "Hair Tie". |
| AC104 | Sardine | |
| PT101 / PT102 | Bateau Body / Petite Bateau Body | Components. |
| OT101 | Splash Photo Book | |
| IN101 | Cleo Underwear | In development. XS-XL, White and Pink. |

Proposed, not confirmed: TP103 Cleo Sweater, TP104 Cleo Tank, TP105 Long Sleeve Cleo Tee, DR103 Cleo Tee Dress, DR104 Scoop Neck Dress, DR105 Christmas Dress, BT102 Tutu.

Not numbered on purpose: Peony and Big Gold Bag (discontinued, Square only). The archived duplicate Cleo Tee (old SKUs end in -OLD).

Unresolved, do not number: Cleo Tee "New Blue" (possibly Splish, ask Cleo), Dolce, Silk Flowers.

## Bateau kits

A handle (AC102) fits both bag sizes and comes in six colors. We sell the bag with its body and handle together, and the handle alone. A customer can also add a handle in another color at checkout. Availability of a bag is limited by the lower of its body and its same-color handle.

## Transition

Old SKUs stay searchable forever. While the system is in transition, show both: `TP101-WHT-01 (was CCSS25COT-WHT01)`. Purchase orders already sent are not revised.
