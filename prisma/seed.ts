/**
 * Seed — everything confirmed as of 2026-09-01.
 *
 * Sources: the Cleo Brand Bible (Google Drive), California Textile Group
 * invoice #29199, Fashion Garcia invoices 324/325, RichLine's quote from
 * Michael Pollack, the Shopify storefront, and Brandon directly.
 *
 * Two rules held throughout:
 *   1. Never invent a number. Unknown is left null and raised as a question.
 *   2. A replaced vendor's figures are NOT inherited by the new vendor.
 *
 * Ids are readable and deterministic so this is safe to re-run.
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { PrismaClient } from '../generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL })
const db = new PrismaClient({ adapter })

const up = <T extends { id: string }>(model: any, rows: T[]) =>
  Promise.all(rows.map((r) => model.upsert({ where: { id: r.id }, create: r, update: r })))

async function main() {
  // ── People ──────────────────────────────────────────────────
  await up(db.person, [
    { id: 'per_cleo',    name: 'Cleo',    role: 'Founder',                        active: true },
    { id: 'per_brandon', name: 'Brandon', role: 'Operations',                     active: true },
    { id: 'per_jane',    name: 'Jane',    role: 'Studio',                         active: true },
    { id: 'per_nicki',   name: 'Nicki',   role: 'Project Manager — Manufacturing', active: true },
  ])

  // ── Location ────────────────────────────────────────────────
  await up(db.location, [
    {
      id: 'loc_studio',
      name: 'Studio',
      address: 'Cleo Couture LLC, 1667 North Main St, Los Angeles, CA 90012',
      isDefault: true,
    },
  ])

  // ── Vendors ─────────────────────────────────────────────────
  await up(db.vendor, [
    // Fabric — RichLine replaces California Textile Group entirely
    { id: 'vnd_richline', name: 'RichLine', role: 'COMPONENT_SUPPLIER',
      contactName: 'Michael Pollack', orderMethod: 'Email', active: true,
      notes: 'Replaces California Textile Group for the tee and underwear program. Supplies both the rib (1137) and the lurex stripe (D1463).' },
    { id: 'vnd_ctg', name: 'California Textile Group', role: 'COMPONENT_SUPPLIER',
      address: '1426 Channing St, Los Angeles, CA 90021',
      contactName: 'Aimee Alparce', contactInfo: 'aimee@californiagroupinc.com',
      paymentTerms: 'COD', active: false,
      notes: 'INACTIVE — replaced by RichLine. Historical: style RIB1000, 1x1 baby rib 100% combed cotton PFD, $2.80/yd, ~65 yd rolls. Do not carry these figures forward.' },

    // Manufacturing — Empire Sewing replaces Fashion Garcia for the Cleo Tee
    { id: 'vnd_empire', name: "Antonio's", legalName: 'Empire Sewing, Inc', role: 'MANUFACTURER',
      address: '910 E 61st Street, DOOR #4, Los Angeles, CA 90001',
      contactName: 'Antonio', active: true,
      notes: 'New Cleo Tee manufacturer, and the delivery address for fabric — RichLine ships direct to them, so fabric never passes through the studio. Phone, turnaround and per-unit price still pending.' },
    { id: 'vnd_garcia', name: 'Fashion Garcia', legalName: 'Fashion Garcia Inc', role: 'MANUFACTURER',
      address: '8616 Otis Ave, 2nd Floor, South Gate, CA 90280',
      contactName: 'Jeremias', contactInfo: '(323) 487-5054 / cell (323) 541-2200', active: false,
      notes: 'INACTIVE for the Cleo Tee — replaced by Empire Sewing. Historical pricing: sew $9.25/unit small run, $8.50/unit at volume; cutting $165 flat on small runs or $0.35/unit at volume; transport $40 per leg. Bible lists address as 8636 Otis St — invoices say 8616 Otis Ave.' },
    { id: 'vnd_lorena', name: 'Lorena and Santos', role: 'MANUFACTURER',
      address: '10408 California Ave, South Gate, CA 90280',
      contactName: 'Lorena', contactInfo: '(323) 695-2964', active: true,
      notes: 'All bags plus the Cachet.' },
    { id: 'vnd_novelty', name: 'Novelty Fashion', role: 'MANUFACTURER',
      address: '1201 W Washington Blvd Unit B, Los Angeles, CA 90007',
      contactName: 'Rolando', contactInfo: '(213) 864-1164', active: true,
      notes: 'Story Dress.' },
    { id: 'vnd_staples', name: 'Staples', role: 'MANUFACTURER', active: true,
      notes: 'Scoop Neck Dress, currently in sampling. Full business name, address, contact and lead time all unknown.' },

    // Dye house
    { id: 'vnd_dye', name: 'LA Dye Masters', role: 'DYE_HOUSE',
      address: '2932 E 11th St, Los Angeles, CA 90023',
      contactName: 'Martin', contactInfo: '(213) 354-4186', active: true,
      notes: 'Garment dyeing for knits. Tee goes manufacturer → dye house → back for buttons and finishing.' },

    // Trim, hardware, materials
    { id: 'vnd_buttons', name: 'Best Buttons and Trim', role: 'COMPONENT_SUPPLIER',
      address: '2833 S Olive St, Los Angeles, CA 90007',
      contactName: 'Mike', contactInfo: 'mike@bestbuttonsandtrims.com',
      orderMethod: 'Email', active: true,
      notes: 'Buttons, Cleo tags, size adjusters. Supplies nearly every product.' },
    { id: 'vnd_leather', name: 'United Leather', role: 'COMPONENT_SUPPLIER',
      address: '1414 Newton St, Los Angeles, CA 90021', active: true },
    { id: 'vnd_denim', name: 'Pacific Blue Denim', role: 'COMPONENT_SUPPLIER',
      address: '1011 E 8th St, Los Angeles, CA 90021',
      contactInfo: '(213) 622-1211', active: true, notes: 'Denim and canvas.' },
    { id: 'vnd_savmore', name: 'Sav-More Leather', role: 'COMPONENT_SUPPLIER',
      address: '1626 Wall St, Los Angeles, CA 90015', active: true, notes: 'Rivets.' },
    { id: 'vnd_keylin', name: 'Keylin Inc', role: 'COMPONENT_SUPPLIER',
      address: '312 E Jefferson Blvd, Los Angeles, CA 90011',
      contactName: 'Jeff Lin', contactInfo: '(323) 232-6700', active: true,
      notes: 'Hook and eye. Possibly snaps — unconfirmed.' },
    { id: 'vnd_zipup', name: 'Zip-Up Zipper Unlimited', role: 'COMPONENT_SUPPLIER',
      address: '828 Wall St, Los Angeles, CA 90014', active: true, notes: 'Invisible zippers.' },
    { id: 'vnd_ukon', name: 'Ukon Zipper', role: 'COMPONENT_SUPPLIER', active: true,
      notes: 'Cachet zipper. Address unknown.' },
    { id: 'vnd_dillu', name: 'Dillu', role: 'COMPONENT_SUPPLIER',
      address: '117 W 9th St, Suite 509, Los Angeles, CA 90015',
      contactInfo: 'dillujha9@gmail.com', active: true, notes: 'Tibetan cotton lining.' },
    { id: 'vnd_liberty', name: 'Liberty London Fabric', role: 'COMPONENT_SUPPLIER', active: true,
      notes: 'Liberty Betsey and Liberty Wiltshire prints. Address and ordering process unknown.' },
    { id: 'vnd_ohio', name: 'Ohio Weaver Supply', role: 'COMPONENT_SUPPLIER', active: true,
      notes: 'Studs. Address and contact not captured in the bible.' },
    { id: 'vnd_magnets', name: 'Amazing Magnets', role: 'COMPONENT_SUPPLIER',
      orderMethod: 'Website — amazingmagnets.com', active: true },
    { id: 'vnd_etsy', name: 'Etsy (Liberty trim)', role: 'COMPONENT_SUPPLIER',
      orderMethod: 'Etsy', active: true, notes: 'Specific shop not recorded.' },
    { id: 'vnd_moo', name: 'Moo', role: 'COMPONENT_SUPPLIER',
      orderMethod: 'Website — moo.com', active: true, notes: 'Cards and hang tags.' },
    { id: 'vnd_amazon', name: 'Amazon', role: 'COMPONENT_SUPPLIER',
      orderMethod: 'Website', active: true,
      notes: 'Glassine bags, stickers, hang tag fasteners, large envelopes.' },
  ])

  // ── Components ──────────────────────────────────────────────
  // unitCostCents / leadTimeDays are null wherever genuinely unknown.
  await up(db.component, [
    { id: 'cmp_fine_rib', name: 'Fine rib cotton', category: 'MATERIAL', vendorId: 'vnd_richline',
      vendorSku: '1137', vendorDescription: 'Rib', unitOfMeasure: 'yard',
      purchaseUnit: 'roll', unitsPerPurchaseUnit: '75',
      unitCostCents: 315, leadTimeDays: 0, locationId: null, active: true,
      notes: 'In stock at RichLine, so effectively no lead time on a PO. $3.15/yd is already the volume price. Rolls vary between 70 and 80 yards (Michael Pollack) — 75 is recorded as the planning midpoint, but an order of N rolls yields somewhere in a +/- 7% band, so never promise exact yardage.' },
    { id: 'cmp_lurex', name: 'Red yarn dye lurex stripe', category: 'MATERIAL', vendorId: 'vnd_richline',
      vendorSku: 'D1463', vendorDescription: 'Red yarn dye lurex stripe',
      spec: '58-60" wide, 220 gsm', unitOfMeasure: 'yard', purchaseUnit: 'roll',
      unitCostCents: 495, leadTimeDays: 21, locationId: null, active: true,
      notes: 'Cosmo Stripe Tee and Cleo Underwear. Three weeks from PO. Referred to internally as "red rayon" — fiber content not formally confirmed.' },
    { id: 'cmp_buttons', name: 'Shell buttons 14l/16l', category: 'TRIM', vendorId: 'vnd_buttons',
      unitOfMeasure: 'button', unitCostCents: 49, locationId: 'loc_studio', active: true,
      notes: 'Price marked "need to double check" in the bible, and conflicts with the loan model which costs buttons+tag together at $1.00. Signature two per garment unless specified otherwise.' },
    { id: 'cmp_tags', name: 'Cleo tags', category: 'TRIM', vendorId: 'vnd_buttons',
      unitOfMeasure: 'tag', unitCostCents: 38, locationId: 'loc_studio', active: true },
    { id: 'cmp_rivets', name: 'Rivets', category: 'HARDWARE', vendorId: 'vnd_savmore',
      unitOfMeasure: 'rivet', unitCostCents: 6, locationId: 'loc_studio', active: true },
    { id: 'cmp_leather', name: 'Leather hide', category: 'MATERIAL', vendorId: 'vnd_leather',
      unitOfMeasure: 'hide', locationId: 'loc_studio', active: true },
    { id: 'cmp_suede', name: 'Tennessee chocolate suede', category: 'MATERIAL', vendorId: 'vnd_leather',
      unitOfMeasure: 'hide', locationId: 'loc_studio', active: true, notes: 'Bateau handles.' },
    { id: 'cmp_denim', name: 'Denim', category: 'MATERIAL', vendorId: 'vnd_denim',
      unitOfMeasure: 'yard', locationId: 'loc_studio', active: true },
    { id: 'cmp_canvas', name: 'Canvas', category: 'MATERIAL', vendorId: 'vnd_denim',
      unitOfMeasure: 'yard', locationId: 'loc_studio', active: true },
    { id: 'cmp_liberty_fabric', name: 'Liberty print fabric', category: 'MATERIAL', vendorId: 'vnd_liberty',
      unitOfMeasure: 'yard', locationId: 'loc_studio', active: true, notes: 'Betsey and Wiltshire prints. Story Dress.' },
    { id: 'cmp_lining', name: 'Tibetan cotton lining', category: 'MATERIAL', vendorId: 'vnd_dillu',
      unitOfMeasure: 'yard', locationId: 'loc_studio', active: true },
    { id: 'cmp_liberty_trim', name: 'Liberty trim', category: 'TRIM', vendorId: 'vnd_etsy',
      unitOfMeasure: 'yard', locationId: 'loc_studio', active: true },
    { id: 'cmp_zip_invisible', name: 'Invisible zipper', category: 'HARDWARE', vendorId: 'vnd_zipup',
      unitOfMeasure: 'zipper', locationId: 'loc_studio', active: true },
    { id: 'cmp_zip_cachet', name: 'Zipper (Cachet)', category: 'HARDWARE', vendorId: 'vnd_ukon',
      unitOfMeasure: 'zipper', locationId: 'loc_studio', active: true },
    { id: 'cmp_hook_eye', name: 'Hook and eye', category: 'HARDWARE', vendorId: 'vnd_keylin',
      unitOfMeasure: 'set', locationId: 'loc_studio', active: true },
    { id: 'cmp_size_adj', name: 'Size adjusters', category: 'HARDWARE', vendorId: 'vnd_buttons',
      unitOfMeasure: 'each', locationId: 'loc_studio', active: true },
    { id: 'cmp_studs', name: 'Studs', category: 'HARDWARE', vendorId: 'vnd_ohio',
      unitOfMeasure: 'stud', locationId: 'loc_studio', active: true },
    { id: 'cmp_snaps', name: 'Snaps', category: 'HARDWARE', vendorId: 'vnd_keylin',
      unitOfMeasure: 'snap', locationId: 'loc_studio', active: true, notes: 'Vendor unconfirmed — bible says "Store- Keylin?"' },
    { id: 'cmp_magnets', name: 'Magnets', category: 'HARDWARE', vendorId: 'vnd_magnets',
      unitOfMeasure: 'magnet', locationId: 'loc_studio', active: true },
    { id: 'cmp_buckle', name: 'Buckle (Cachet)', category: 'HARDWARE',
      unitOfMeasure: 'buckle', locationId: 'loc_studio', active: true, notes: 'Vendor not recorded.' },

    // Sub-assembly
    { id: 'cmp_bateau_handles', name: 'Bateau handles', category: 'SUBASSEMBLY',
      unitOfMeasure: 'pair', locationId: 'loc_studio', active: true,
      notes: 'Made from suede and rivets before going into the bag.' },

    // Packaging — consumed per SHIPMENT, not per production run
    { id: 'cmp_glassine', name: 'Glassine bags', category: 'PACKAGING', vendorId: 'vnd_amazon',
      unitOfMeasure: 'bag', locationId: 'loc_studio', active: true,
      notes: 'May need a bulk alternative per the bible.' },
    { id: 'cmp_stickers_silver', name: 'Silver stickers', category: 'PACKAGING', vendorId: 'vnd_amazon',
      unitOfMeasure: 'sticker', locationId: 'loc_studio', active: true },
    { id: 'cmp_stickers_number', name: 'Number stickers', category: 'PACKAGING', vendorId: 'vnd_amazon',
      unitOfMeasure: 'sticker', locationId: 'loc_studio', active: true },
    { id: 'cmp_hangtags', name: 'Hang tags', category: 'PACKAGING', vendorId: 'vnd_moo',
      unitOfMeasure: 'tag', locationId: 'loc_studio', active: true },
    { id: 'cmp_hangtag_fast', name: 'Hang tag fasteners', category: 'PACKAGING', vendorId: 'vnd_amazon',
      unitOfMeasure: 'fastener', locationId: 'loc_studio', active: true },
    { id: 'cmp_moo_cards', name: 'Moo cards', category: 'PACKAGING', vendorId: 'vnd_moo',
      unitOfMeasure: 'card', locationId: 'loc_studio', active: true },
    { id: 'cmp_envelopes', name: 'Large envelopes', category: 'PACKAGING', vendorId: 'vnd_amazon',
      unitOfMeasure: 'envelope', locationId: 'loc_studio', active: true },
  ])

  // ── Products ────────────────────────────────────────────────
  await up(db.product, [
    { id: 'prd_cleo_tee', name: 'Cleo Tee', status: 'ACTIVE', retailPriceCents: 8800,
      notes: 'Hero product. Manufacturer moving from Fashion Garcia to Empire Sewing. Fabric moving from California Textile Group to RichLine.' },
    { id: 'prd_you_dress', name: 'You Dress', status: 'ACTIVE', retailPriceCents: 14800,
      notes: 'Shares the tee production stack — same fabric, same manufacturer, same dye house.' },
    { id: 'prd_story_dress', name: 'Story Dress', status: 'ACTIVE', retailPriceCents: 34800,
      notes: 'Reorder in progress with Novelty Fashion; date not yet confirmed.' },
    { id: 'prd_cleo_bag', name: 'Cleo Bag', status: 'ACTIVE', retailPriceCents: 42800 },
    { id: 'prd_cleo_bag_denim', name: 'Cleo Bag — Denim', status: 'ACTIVE' },
    { id: 'prd_bateau', name: 'Bateau Bag', status: 'ACTIVE' },
    { id: 'prd_petite_bateau', name: 'Petite Bateau Bag', status: 'ACTIVE' },
    { id: 'prd_bean_bag', name: 'Bean Bag', status: 'ACTIVE', retailPriceCents: 36800 },
    { id: 'prd_cachet', name: 'Cachet', status: 'ACTIVE', retailPriceCents: 28200 },
    { id: 'prd_olive_bag', name: 'Olive Bag', status: 'ACTIVE', retailPriceCents: 42800,
      notes: 'Same workflow as the other bags. No sourcing document exists.' },
    { id: 'prd_little_sister', name: 'Little Sister', status: 'SUNSETTED', retailPriceCents: 34800 },

    // In development
    { id: 'prd_cosmo_tee', name: 'Cosmo Stripe Tee', status: 'DEVELOPMENT',
      notes: 'Cosmopolitan collaboration. Same pattern and workflow as the Cleo Tee; the lurex stripe fabric is the only change. About to start manufacturing.' },
    { id: 'prd_ls_tee', name: 'Long Sleeve Cleo Tee', status: 'DEVELOPMENT',
      notes: 'Same tee, long sleeves. Same manufacturer and fabric as the Cleo Tee.' },
    { id: 'prd_underwear', name: 'Cleo Underwear', status: 'DEVELOPMENT',
      notes: 'First run 70-100 units, made from leftover lurex stripe yardage off the Cosmo tee buy. Same manufacturer as the tee.' },
    { id: 'prd_scoop_dress', name: 'Scoop Neck Dress', status: 'SAMPLING',
      notes: 'In sampling with Staples.' },
    { id: 'prd_sweater', name: 'Cleo Sweater', status: 'DEVELOPMENT', notes: 'Unnamed. All details TBD.' },
    { id: 'prd_red_bag', name: 'Red Bag', status: 'DEVELOPMENT', notes: 'Same manufacturer as the Cleo Bag. Details TBD.' },
  ])

  // ── Colorways — customer name and dye house name ─────────────
  await up(db.colorway, [
    { id: 'clr_tee_black',   productId: 'prd_cleo_tee', customerName: 'Black',      dyeHouseName: 'Jet Black',        active: true },
    { id: 'clr_tee_white',   productId: 'prd_cleo_tee', customerName: 'White',      dyeHouseName: 'Optic White',      active: true },
    { id: 'clr_tee_sun',     productId: 'prd_cleo_tee', customerName: 'Sunshine',   dyeHouseName: 'Pastel Yellow',    active: true },
    { id: 'clr_tee_shell',   productId: 'prd_cleo_tee', customerName: 'Shell',      dyeHouseName: 'Shrinking Violet', active: true },
    { id: 'clr_tee_pink',    productId: 'prd_cleo_tee', customerName: 'Hot Pink',   inHouseMatch: true, active: true,
      notes: 'In-house colour match originating from a Depop find. No dye house name on file — how it is reordered is an open question.' },
    { id: 'clr_tee_blue',    productId: 'prd_cleo_tee', customerName: 'New Blue',   dyeHouseName: 'Blue Atol',        active: true,
      notes: 'Listed as active in the bible but described as new — confirm whether it is in production.' },
    { id: 'clr_tee_splish',  productId: 'prd_cleo_tee', customerName: 'Splish',     active: true,
      notes: 'Sold on the website. Distinct from Splash — confirmed by Brandon.' },
    { id: 'clr_tee_ruby',    productId: 'prd_cleo_tee', customerName: 'Ruby Red',   inHouseMatch: true, active: false,
      notes: "Inactive. In-house match, described in the bible as Dantana's Tshirt Match." },
    { id: 'clr_tee_black_berry', productId: 'prd_cleo_tee', customerName: 'Blackberry', dyeHouseName: 'Mauve', active: false },
    { id: 'clr_tee_splash',  productId: 'prd_cleo_tee', customerName: 'Splash Neverworns', pantone: '639C', active: false },
    { id: 'clr_you_black',   productId: 'prd_you_dress', customerName: 'Black', dyeHouseName: 'Jet Black',   active: true },
    { id: 'clr_you_white',   productId: 'prd_you_dress', customerName: 'White', dyeHouseName: 'Optic White', active: true },
  ])

  // ── Bills of materials — only what is actually known ─────────
  await up(db.bomLine, [
    // Cleo Tee — 1.50 yd confirmed in the loan model; two buttons is the signature
    { id: 'bom_tee_fabric',  parentProductId: 'prd_cleo_tee', componentId: 'cmp_fine_rib', qtyPerUnit: '1.5',
      notes: 'Confirmed in the loan model. Measured on the CTG rib — reconfirm against RichLine 1137 if the spec differs.' },
    { id: 'bom_tee_buttons', parentProductId: 'prd_cleo_tee', componentId: 'cmp_buttons',  qtyPerUnit: '2',
      notes: 'Signature two, per Brandon.' },
    { id: 'bom_tee_tag',     parentProductId: 'prd_cleo_tee', componentId: 'cmp_tags',     qtyPerUnit: '1' },

    // Long sleeve — 1.80 yd from the loan model, marked an estimate there
    { id: 'bom_ls_fabric',  parentProductId: 'prd_ls_tee', componentId: 'cmp_fine_rib', qtyPerUnit: '1.8',
      notes: 'Loan model estimate, not measured.' },
    { id: 'bom_ls_buttons', parentProductId: 'prd_ls_tee', componentId: 'cmp_buttons',  qtyPerUnit: '2' },
    { id: 'bom_ls_tag',     parentProductId: 'prd_ls_tee', componentId: 'cmp_tags',     qtyPerUnit: '1' },

    // Cosmo tee — buttons and tag known, YARDAGE DELIBERATELY OMITTED
    { id: 'bom_cosmo_buttons', parentProductId: 'prd_cosmo_tee', componentId: 'cmp_buttons', qtyPerUnit: '2' },
    { id: 'bom_cosmo_tag',     parentProductId: 'prd_cosmo_tee', componentId: 'cmp_tags',    qtyPerUnit: '1' },

    // You Dress — buttons and tag known, yardage unknown
    { id: 'bom_you_buttons', parentProductId: 'prd_you_dress', componentId: 'cmp_buttons', qtyPerUnit: '2' },
    { id: 'bom_you_tag',     parentProductId: 'prd_you_dress', componentId: 'cmp_tags',    qtyPerUnit: '1' },

    // Bateau handles as a sub-assembly of the bag
    { id: 'bom_bateau_handles', parentProductId: 'prd_bateau', componentId: 'cmp_bateau_handles', qtyPerUnit: '1' },
    { id: 'bom_handles_suede',  parentComponentId: 'cmp_bateau_handles', componentId: 'cmp_suede',  qtyPerUnit: '0' ,
      notes: 'Quantity unknown — placeholder so the sub-assembly relationship is recorded.' },
    { id: 'bom_handles_rivets', parentComponentId: 'cmp_bateau_handles', componentId: 'cmp_rivets', qtyPerUnit: '0',
      notes: 'Quantity unknown.' },

    // Tags appear on essentially everything
    { id: 'bom_cleo_bag_tag',   parentProductId: 'prd_cleo_bag',      componentId: 'cmp_tags', qtyPerUnit: '1' },
    { id: 'bom_bateau_tag',     parentProductId: 'prd_bateau',        componentId: 'cmp_tags', qtyPerUnit: '1' },
    { id: 'bom_petite_tag',     parentProductId: 'prd_petite_bateau', componentId: 'cmp_tags', qtyPerUnit: '1' },
    { id: 'bom_bean_tag',       parentProductId: 'prd_bean_bag',      componentId: 'cmp_tags', qtyPerUnit: '1' },
    { id: 'bom_cachet_tag',     parentProductId: 'prd_cachet',        componentId: 'cmp_tags', qtyPerUnit: '1' },
    { id: 'bom_story_tag',      parentProductId: 'prd_story_dress',   componentId: 'cmp_tags', qtyPerUnit: '1' },
  ])

  // ── Quick links ─────────────────────────────────────────────
  await up(db.fileLink, [
    { id: 'lnk_bible', title: 'Cleo Brand Bible — sourcing docs', category: 'Reference', sortOrder: 1,
      url: 'https://drive.google.com/drive/folders/1XWdnqEvzhEbS0f8Q_3T0O7xNoaTmBS7_' },
    { id: 'lnk_intake', title: 'Studio Mouse — Questions for Cleo', category: 'Reference', sortOrder: 2,
      url: 'https://docs.google.com/document/d/1JpjjR01t6UZDqI2zAcSgm_elUDUasT8gPt6naEu7smc/edit' },
    { id: 'lnk_business', title: 'Business docs — line sheet, deck, pricing', category: 'Reference', sortOrder: 3,
      url: 'https://drive.google.com/drive/folders/1K2Vuq__gzqlx0n91BHaqPm2nonIeJjKg' },
    { id: 'lnk_shop', title: 'cleocamp.com', category: 'Shop', sortOrder: 4, url: 'https://cleocamp.com' },
  ])

  // ── Open questions — what Studio Mouse knows it doesn't know ─
  const q = (
    id: string, title: string, detail: string = '',
    entityType: string = 'GENERAL', entityId: string | null = null,
  ) => ({ id, kind: 'QUESTION' as const, entityType, entityId, title, detail,
          source: 'SYSTEM' as const, resolved: false, remindDaysBefore: null })

  await up(db.actionItem, [
    q('aq_richline_rib_roll', 'How many yards on a RichLine rib roll?',
      'Fabric is bought by the roll and used by the yard. Without the roll size, a reorder cannot be expressed in something RichLine can actually sell. California Textile Group rolls averaged about 65 yards; RichLine may differ.',
      'COMPONENT', 'cmp_fine_rib'),
    q('aq_richline_rib_spec', 'Is RichLine style 1137 the same spec as the old rib?',
      'The 1.50 yards per tee figure was measured on California Textile Group RIB1000 — 1x1 baby rib, 100% combed cotton, PFD. If 1137 differs in width or weight, yield per yard changes and every fabric calculation moves with it.',
      'COMPONENT', 'cmp_fine_rib'),
    q('aq_cosmo_yardage', 'How many yards of lurex stripe per Cosmo tee?',
      'D1463 is 58-60" wide at 220 gsm. The 1.50 yd/tee figure comes from the rib and cannot be assumed to carry over. Blocks any Cosmo tee forecast.',
      'PRODUCT', 'prd_cosmo_tee'),
    q('aq_empire_price', "Empire Sewing's per-unit price and turnaround",
      'Antonio has said he will match Fashion Garcia pricing with a shorter turnaround, but neither figure is confirmed. Worth clarifying whether "match" includes the volume break and the flat cutting charge — at 112 units those are very different deals.',
      'VENDOR', 'vnd_empire'),
    q('aq_empire_phone', "Empire Sewing's phone number",
      'Address is on file (910 E 61st Street, DOOR #4, Los Angeles, CA 90001) but no phone.',
      'VENDOR', 'vnd_empire'),
    q('aq_staples_details', 'Staples — full business name, contact, lead time, pricing',
      'Manufacturer for the Scoop Neck Dress, currently in sampling. Nothing beyond the name is on file.',
      'VENDOR', 'vnd_staples'),
    q('aq_dye_leadtime', 'How long does LA Dye Masters take?',
      'And is it on top of the manufacturer time? The tee goes manufacturer → dye house → back for buttons and finishing. Each leg needs a duration before a restock date can be projected.',
      'VENDOR', 'vnd_dye'),
    q('aq_prod_leadtimes', 'Manufacturing turnaround for each product',
      'None of Empire Sewing, Lorena and Santos, Novelty Fashion or Staples has a recorded turnaround. This blocks the finished-goods restock date on every product.'),
    q('aq_component_leadtimes', 'Lead times for every component supplier',
      'Not one lead time appears anywhere in the sourcing documents. Needed for Best Buttons and Trim, United Leather, Pacific Blue Denim, Liberty, and the zipper and hardware suppliers.'),
    q('aq_button_price', 'Do two buttons and a tag cost $1.36 or $1.00?',
      'Two buttons at $0.49 plus a $0.38 tag is $1.36. The loan model costs buttons and tag together at $1.00 — a 36% gap that changes what every tee costs to make. If $1.00 is right, is it negotiated, rounded, or a different button count?',
      'COMPONENT', 'cmp_buttons'),
    q('aq_button_exceptions', 'Which products do not take the signature two buttons?',
      'The Cleo Bag document mentions possibly needing 18l or 20l, and the denim Cleo Bag does not name a size at all.',
      'COMPONENT', 'cmp_buttons'),
    q('aq_sizes', 'What sizes does each product come in?',
      'Numbers, letters, or one-size — and which sizes actually get made. No product variants can be created until this is answered, which means no finished-goods inventory can be tracked.'),
    q('aq_onhand', 'Count everything in the studio',
      'Day one is a counting day: components, finished pieces by size and colour, and packaging. Enter it once together, after which Studio Mouse keeps its own running count.'),
    q('aq_packaging_rate', 'How many packaging pieces per shipped order?',
      'Glassine bags, silver stickers, number stickers, hang tags, fasteners, Moo cards, large envelopes. These deplete per shipment rather than per production run, and running out stops fulfilment.'),
    q('aq_bag_boms', 'What goes into each bag?',
      'Leather per Cleo Bag and Bean Bag, canvas per Bateau, plus rivet, stud, snap and magnet counts. Also the suede and rivet quantities for a pair of Bateau handles.'),
    q('aq_dress_yardage', 'Yardage for the You Dress and Story Dress'),
    q('aq_material_prices', 'Prices for leather, denim, canvas and Liberty fabric',
      'All blank in the sourcing documents.'),
    q('aq_hardware_prices', 'Prices for zippers, hook and eye, size adjusters, studs, snaps, magnets and the Cachet buckle'),
    q('aq_moqs', 'Do any suppliers have minimum orders, or price breaks at volume?',
      'Buttons by the gross, fabric by the roll, leather by the hide. Studio Mouse must never invent a price break, so it can only mention one that is recorded here.'),
    q('aq_hot_pink', 'How is Hot Pink reordered?',
      'It is an in-house colour match with no dye house name. Is there a swatch Martin keeps on file, a Pantone reference, or does someone re-match it each run?',
      'PRODUCT', 'prd_cleo_tee'),
    q('aq_new_blue', 'Is New Blue in production, or still an idea?', '', 'PRODUCT', 'prd_cleo_tee'),
    q('aq_neverworns', 'What are Splish, Splash and the Neverworns Edition?',
      'The website sells a Splish tee and a separate Neverworns Edition; the sourcing document lists "Splash Neverworns" at Pantone 639C. Splish and Splash are confirmed as different things, but which are colours, which are editions, and which are still made is unclear.',
      'PRODUCT', 'prd_cleo_tee'),
    q('aq_run_sizes', 'What is a typical production run per product?',
      'Fashion Garcia invoices show runs of 112 and 1,411 units in the same month, so the range is wide. Needed before Studio Mouse can say whether a proposed quantity looks low.'),
    q('aq_wholesale', 'Which wholesale accounts are active, and what does a typical order look like?',
      'Wholesale shipments count as demand, so they matter to forecasting.'),
    q('aq_offshopify', 'Is there stock that never appears on Shopify?',
      'Samples, seconds, or wholesale-only styles. Shopify is the master for finished goods, so anything it does not know about needs to be handled here.'),
  ])

  // ── Workflow notes ──────────────────────────────────────────
  await up(db.note, [
    { id: 'not_tee_workflow', entityType: 'PRODUCT', entityId: 'prd_cleo_tee', source: 'SYSTEM',
      content: 'Production sequence: fabric goes to the manufacturer → cut and sewn → out to LA Dye Masters for colour → back to the manufacturer for buttons and finishing → picked up and brought to the studio. Nothing counts as inventory until it reaches the studio. Fabric is bought PFD (prepared for dyeing); no blank stock is held, and they dye as many as they manufacture.' },
    { id: 'not_packaging', entityType: 'GENERAL', source: 'SYSTEM',
      content: 'Packaging consumables deplete per shipped order rather than per production run. They are watched the same way components are, but their usage is driven by order volume.' },
    { id: 'not_vendor_change', entityType: 'PRODUCT', entityId: 'prd_cleo_tee', source: 'SYSTEM',
      content: 'Two vendor changes are in progress: fabric from California Textile Group to RichLine, and manufacturing from Fashion Garcia to Empire Sewing. The old records are retained as inactive with their history, but none of their prices or lead times carry forward to the new vendors.' },
  ])


  // ── Products that only existed on Shopify ───────────────────
  await up(db.product, [
    { id: 'prd_boy_belt', name: 'Boy Belt', status: 'ACTIVE',
      notes: 'Found on Shopify, absent from the brand bible. The loan model references an imported leather belt at roughly EUR 40. Sourcing unknown.' },
    { id: 'prd_photobook', name: 'Splash Photo Book', status: 'ACTIVE',
      notes: 'Found on Shopify, absent from the brand bible. Not a manufactured garment — no BOM.' },
  ])

  // ── Colorways discovered from the Shopify catalog ────────────
  await up(db.colorway, [
    { id: 'clr_story_red',       productId: 'prd_story_dress',   customerName: 'Red (Wiltshire)',  active: true },
    { id: 'clr_story_green',     productId: 'prd_story_dress',   customerName: 'Green (Betsey)',   active: true },
    { id: 'clr_bean_champagne',  productId: 'prd_bean_bag',      customerName: 'Champagne',        active: true },
    { id: 'clr_bean_black',      productId: 'prd_bean_bag',      customerName: 'Black',            active: true },
    { id: 'clr_bean_silver',     productId: 'prd_bean_bag',      customerName: 'Silver',           active: true },
    { id: 'clr_bat_silver',      productId: 'prd_bateau',        customerName: 'Silver',           active: true, notes: 'Handle colour.' },
    { id: 'clr_bat_gold',        productId: 'prd_bateau',        customerName: 'Gold',             active: true, notes: 'Handle colour.' },
    { id: 'clr_bat_mara',        productId: 'prd_bateau',        customerName: 'Maraschino',       active: true, notes: 'Handle colour.' },
    { id: 'clr_bat_verd',        productId: 'prd_bateau',        customerName: 'Verdant',          active: true, notes: 'Handle colour.' },
    { id: 'clr_bat_casp',        productId: 'prd_bateau',        customerName: 'Caspian',          active: true, notes: 'Handle colour.' },
    { id: 'clr_bat_choc',        productId: 'prd_bateau',        customerName: 'Chocolate',        active: true, notes: 'Handle colour. Matches the Tennessee chocolate suede in the bible.' },
    { id: 'clr_pbat_gold',       productId: 'prd_petite_bateau', customerName: 'Gold',             active: true },
    { id: 'clr_pbat_silver',     productId: 'prd_petite_bateau', customerName: 'Silver',           active: true },
    { id: 'clr_pbat_mara',       productId: 'prd_petite_bateau', customerName: 'Maraschino',       active: true },
    { id: 'clr_pbat_verd',       productId: 'prd_petite_bateau', customerName: 'Verdant',          active: true },
    { id: 'clr_pbat_casp',       productId: 'prd_petite_bateau', customerName: 'Caspian',          active: true },
    { id: 'clr_cbd_blue',        productId: 'prd_cleo_bag_denim',customerName: 'Baby Blue',        active: true, notes: 'Bow colour.' },
    { id: 'clr_cbd_pink',        productId: 'prd_cleo_bag_denim',customerName: 'Pink',             active: true, notes: 'Bow colour.' },
    { id: 'clr_cb_leather',      productId: 'prd_cleo_bag',      customerName: 'Leather',          active: true },
    { id: 'clr_cb_silver',       productId: 'prd_cleo_bag',      customerName: 'Silver',           active: true },
    { id: 'clr_cb_black',        productId: 'prd_cleo_bag',      customerName: 'Black Leather',    active: true },
    { id: 'clr_ls_black',        productId: 'prd_little_sister', customerName: 'Black',            active: false },
  ])

  // ── Variants, straight from the Shopify catalog ──────────────
  // Sizes and variant ids come from Shopify because Shopify is the master for
  // finished goods. Asking Cleo for something Shopify already knows would be
  // exactly the kind of unnecessary question Studio Mouse must not ask.
  const catalog = JSON.parse(
    readFileSync(new URL('./shopify-catalog.json', import.meta.url), 'utf8'),
  ) as { products: Array<{ productId: string; priceCents: number | null;
        colorways: Record<string,string>;
        variants: Array<[string|null, string|null, number, number|null]> }> }

  const variantRows = catalog.products.flatMap((p) =>
    p.variants.map(([colorName, size, shopifyVariantId, priceCents]) => ({
      id: 'var_' + shopifyVariantId,
      productId: p.productId,
      colorwayId: colorName ? (p.colorways[colorName] ?? null) : null,
      shopifyVariantId: String(shopifyVariantId),
      size,
      retailPriceCents: priceCents,
      locationId: 'loc_studio',
      // NULL, not zero. Nothing has been counted yet — see aq_onhand.
      onHandQty: null,
    })),
  )
  await up(db.productVariant, variantRows)

  // Retail prices come from Shopify — it is the master for what things sell
  // for, just as it is for finished-goods counts. Asking Cleo would be asking
  // for something the system already knows.
  await Promise.all(
    [...new Map(catalog.products.filter((p) => p.priceCents)
      .map((p) => [p.productId, p.priceCents])).entries()]
      .map(([productId, priceCents]) =>
        db.product.update({ where: { id: productId }, data: { retailPriceCents: priceCents } })),
  )

  // ── Cosmo tee: same pattern as the Cleo Tee, so same yardage ──
  await up(db.bomLine, [
    { id: 'bom_cosmo_fabric', parentProductId: 'prd_cosmo_tee', componentId: 'cmp_lurex',
      qtyPerUnit: '1.5',
      notes: 'Confirmed by Brandon: the Cosmo Stripe Tee uses the exact same pattern as the Cleo Tee, so yardage carries over at 1.50 yd/unit.' },
  ])

  // ── Questions Shopify and Brandon have now answered ──────────
  const resolve = (id: string, resolutionNote: string) =>
    db.actionItem.updateMany({
      where: { id },
      data: { resolved: true, resolvedAt: new Date(), resolutionNote },
    })

  await Promise.all([
    resolve('aq_richline_rib_roll',
      'Answered by Michael Pollack: rolls vary between 70 and 80 yards. Recorded as 75 for planning, with the variance noted — ordering N rolls yields a range, not an exact yardage.'),
    resolve('aq_sizes',
      'Answered from the Shopify catalog. Tees and the You Dress run sizes 1/2/3; the Story Dress runs 0/1/2/3; the Boy Belt runs XS/S/M/L; the Bean Bag runs Petite/Medium. Bags other than the Bean Bag vary by colour rather than size.'),
    resolve('aq_neverworns',
      'Resolved from the Shopify catalog. "Splash" is the colourway of the Cleo Tee - Neverworns Edition. "Splish" is a separate Cleo Tee colourway with its own listing. They are different products, as Brandon confirmed.'),
    resolve('aq_cosmo_yardage',
      'Answered by Brandon: the Cosmo Stripe Tee uses the exact same pattern as the Cleo Tee, so 1.50 yd/unit applies.'),
  ])

  // ── What the storefront could not tell us ───────────────────
  await up(db.actionItem, [
    { id: 'aq_shopify_admin', kind: 'QUESTION', entityType: 'GENERAL', entityId: null,
      title: 'Connect the Shopify Admin API',
      detail: 'The public storefront gave us the catalogue and variant ids, but not inventory levels or order history. A Shopify custom app with read_products, read_inventory and read_orders would supply the on-hand counts and the sales history the forecast runs on. write_inventory follows in Phase 1 for the write-through.',
      source: 'SYSTEM', resolved: false, remindDaysBefore: null },
    { id: 'aq_cleo_bag_split', kind: 'QUESTION', entityType: 'PRODUCT', entityId: 'prd_cleo_bag',
      title: 'The Cleo Bag is four separate listings on Shopify',
      detail: 'Shopify carries cleo-bag, cleo-bag-silver, cleo-bag-black-leather and cleo-bag-denim as four distinct products. They are modelled here as one Cleo Bag with colourways plus a separate denim product. Confirm that grouping is how you think about them, or say how you would rather see it.',
      source: 'SYSTEM', resolved: false, remindDaysBefore: null },
    { id: 'aq_boy_belt', kind: 'QUESTION', entityType: 'PRODUCT', entityId: 'prd_boy_belt',
      title: 'Boy Belt and Splash Photo Book are not in the brand bible',
      detail: 'Both are live on Shopify. The Boy Belt runs XS to L and the loan model mentions an imported leather belt at about EUR 40. Who supplies them, and should Studio Mouse track their components at all?',
      source: 'SYSTEM', resolved: false, remindDaysBefore: null },
  ])

  // ── Live purchase orders ────────────────────────────────────
  // Fabric is delivered to Empire Sewing, not the studio. Component.incomingQty
  // derives from open lines like these.
  await up(db.purchaseOrder, [
    { id: 'po_2356', poNumber: '2356', vendorId: 'vnd_richline', status: 'SENT',
      orderedAt: new Date('2026-09-01T12:00:00-07:00'),
      expectedAt: new Date('2026-09-22T12:00:00-07:00'),
      shipToLocationId: null,
      notes: 'Cosmo Stripe Tee fabric. Three week lead time. Rolls run 70-80 yd so the delivered yardage will not be exactly 1,000.' },
    { id: 'po_2357', poNumber: '2357', vendorId: 'vnd_richline', status: 'SENT',
      orderedAt: new Date('2026-09-01T12:00:00-07:00'),
      shipToLocationId: null,
      notes: 'Cleo Tee fabric. Quoted in stock, ship date to be confirmed.' },
  ])
  await up(db.purchaseOrderLine, [
    { id: 'pol_2356_1', purchaseOrderId: 'po_2356', componentId: 'cmp_lurex',
      qtyOrdered: '1000', unit: 'yards', unitCostCents: 495, qtyReceived: '0' },
    { id: 'pol_2357_1', purchaseOrderId: 'po_2357', componentId: 'cmp_fine_rib',
      qtyOrdered: '1000', unit: 'yards', unitCostCents: 315, qtyReceived: '0' },
  ])
  // incomingQty is derived, never set by hand
  for (const [componentId] of [['cmp_lurex'], ['cmp_fine_rib']]) {
    const open = await db.purchaseOrderLine.findMany({
      where: { componentId, purchaseOrder: { status: { in: ['SENT', 'PARTIALLY_RECEIVED'] } } },
    })
    const incoming = open.reduce((s, l) => s + Number(l.qtyOrdered) - Number(l.qtyReceived), 0)
    await db.component.update({ where: { id: componentId }, data: { incomingQty: String(incoming) } })
  }

  const counts = {
    people: await db.person.count(),
    vendors: await db.vendor.count(),
    components: await db.component.count(),
    products: await db.product.count(),
    colorways: await db.colorway.count(),
    bomLines: await db.bomLine.count(),
    openQuestions: await db.actionItem.count({ where: { resolved: false } }),
    notes: await db.note.count(),
    links: await db.fileLink.count(),
    variants: await db.productVariant.count(),
    resolvedQuestions: await db.actionItem.count({ where: { resolved: true } }),
    purchaseOrders: await db.purchaseOrder.count(),
  }
  console.log('Seeded:', counts)
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1) })
