/**
 * What every one of Mouse's tools is, in one place (8 Oct 2026). The read
 * lane's tool set, the practice set and what counts as a write are all read
 * from here, and tests/tool-kinds.test.ts fails on a tool in TOOLS that is
 * not listed, so a new tool has to be put in a kind before it ships.
 *
 *   read-lane      Looks things up and changes nothing. The read lane (Sonnet) holds it.
 *   look-up, Opus  Looks things up and changes nothing, but only Opus holds it. A
 *                  question that needs it is sent to Opus by the router (NEEDS_OPUS_TOOL).
 *   answers, Opus  Changes things, but some questions need it too (a "list" action,
 *                  or it settles records as it reads). Only Opus holds it; the router
 *                  sends those questions to Opus as for look-up, Opus.
 *   changes        Changes, sends or records something. Never in the read lane.
 *
 * Brandon, 8 Oct 2026: "we can't make mouse dumber. so either these things
 * are added or it switches to higher model." Nothing a question needs may be
 * left to Sonnet to notice it lacks. Pure: no imports.
 */
export type ToolKind = 'read-lane' | 'look-up, Opus' | 'answers, Opus' | 'changes'

export const TOOL_KINDS: Record<string, ToolKind> = {
  // Look-ups the read lane holds (the set approved 7 Oct 2026, plus shipped_orders 8 Oct).
  open_record: 'read-lane',
  query_status: 'read-lane',
  check_sent_mail: 'read-lane',
  search_chat: 'read-lane',
  find_in_shopify: 'read-lane',
  find_customer: 'read-lane',
  find_contacts: 'read-lane',
  reorder_math: 'read-lane',
  shopify_analytics: 'read-lane',
  unpaid_live_sales: 'read-lane',
  shipped_orders: 'read-lane',

  // Look-ups kept with Opus.
  read_file: 'look-up, Opus', // reading a PDF or photo stays with Opus (7 Oct 2026)
  draft_order_links: 'look-up, Opus', // kept with Opus since the lane was approved
  // One email in full, by id (9 Oct 2026). With Opus so the turn's one full read is
  // Opus's own: an email Sonnet opened would not travel with the hand-over, and the
  // turn's budget would then keep Opus from opening it. The lane keeps the compact search.
  open_email: 'look-up, Opus',

  // Change things, and also answer questions.
  muse_tasks: 'answers, Opus', // reading a task files the team's answers onto Muse's questions
  stylist_inventory: 'answers, Opus', // "list" shows it; add, remove and count change it
  update_line_sheet: 'answers, Opus', // "list" shows the current words; the rest edits the sheet

  add_note: 'changes',
  cancel_live_sale: 'changes',
  close_muse_task: 'changes',
  close_purchase_order: 'changes',
  close_stylist_pull: 'changes',
  correct_inventory_event: 'changes',
  create_calendar_event: 'changes',
  create_colorway: 'changes',
  create_component: 'changes',
  create_product: 'changes',
  create_product_variants: 'changes',
  create_production_run: 'changes',
  create_purchase_order: 'changes',
  create_todo: 'changes',
  create_vendor: 'changes',
  create_wholesale_account: 'changes',
  delete_calendar_event: 'changes',
  dismiss_alert: 'changes',
  email_invoice_copy: 'changes',
  flag_for_brandon: 'changes',
  gift_items: 'changes',
  hand_to_muse: 'changes',
  import_from_shopify: 'changes',
  invoice_live_sale: 'changes',
  invoice_wholesale: 'changes',
  keep_file: 'changes',
  log_inventory_event: 'changes',
  log_wholesale_shipment: 'changes',
  merge_colorway: 'changes',
  merge_component: 'changes',
  note_problem: 'changes', // writes the troubleshooting log
  raise_question: 'changes',
  record_financials: 'changes',
  record_pull_return: 'changes',
  record_stylist_pull: 'changes',
  record_stylist_request: 'changes',
  refresh_corner: 'changes',
  refund_friends_family: 'changes',
  remove_contact: 'changes',
  rename_variant_sizes: 'changes',
  resolve_item: 'changes',
  retire_note: 'changes',
  save_contact: 'changes',
  save_customer: 'changes',
  save_stylist: 'changes',
  send_back_to_muse: 'changes',
  send_context_snapshot: 'changes',
  send_email: 'changes',
  send_line_sheet: 'changes',
  send_purchase_order: 'changes',
  send_wholesale_draft: 'changes',
  set_request_pieces: 'changes',
  set_wholesale_price: 'changes',
  style_numbers: 'changes',
  sync_shopify: 'changes',
  transfer_component_stock: 'changes',
  update_colorway: 'changes',
  update_component: 'changes',
  update_document_defaults: 'changes',
  update_notification_settings: 'changes',
  update_person_email: 'changes',
  update_product: 'changes',
  update_product_bom: 'changes',
  update_production_run: 'changes',
  update_purchase_order: 'changes',
  update_purchase_order_lines: 'changes',
  update_stylist_pull: 'changes',
  update_stylist_request: 'changes',
  update_todo: 'changes',
  update_vendor: 'changes',
  update_wholesale_account: 'changes',
  update_wholesale_shipment: 'changes',
}

const named = (...kinds: ToolKind[]) =>
  new Set(Object.entries(TOOL_KINDS).filter(([, k]) => kinds.includes(k)).map(([n]) => n))

/** The read lane's whole tool set. */
export const READ_LANE_KIND = named('read-lane')
/** Tools that look things up and change nothing, wherever they run. */
export const LOOK_UP_KIND = named('read-lane', 'look-up, Opus')
/** Tools a question may need that the read lane does not hold: the router sends such questions to Opus. */
export const OPUS_ONLY_ANSWERS = named('look-up, Opus', 'answers, Opus')
