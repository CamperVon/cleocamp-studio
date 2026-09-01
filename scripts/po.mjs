/**
 * Purchase order generator.
 *
 * Renders a PO to HTML and prints it with headless Chrome. Studio Mouse will
 * call this same code path once the chat can create orders — the point is that
 * the layout and the numbers live in one place, not in a template someone
 * retypes.
 *
 *   node scripts/po.mjs po-2356.json
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const money = (c) => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const qty = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })

function html(po) {
  const lines = po.lines.map((l) => ({ ...l, total: Math.round(l.qty * l.unitCostCents) }))
  const subtotal = lines.reduce((s, l) => s + l.total, 0)

  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { size: letter; margin: 0.85in 0.8in; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: "Times New Roman", Times, serif; color:#14181A; font-size:11pt; line-height:1.5; }
  .mark { font-style: italic; font-size: 22pt; letter-spacing: .14em; }
  .sub { font-size: 8.5pt; letter-spacing:.09em; text-transform:uppercase; color:#6A736F; margin-top:6px; }
  .rule { border:0; border-top:1px solid #14181A; margin:16px 0 22px; }
  .row { display:flex; justify-content:space-between; gap:26px; }
  .col { flex:1; }
  h2 { font-size:8.5pt; letter-spacing:.11em; text-transform:uppercase; color:#6A736F;
       font-weight:normal; margin:0 0 5px; font-family: Helvetica, Arial, sans-serif; }
  .meta { text-align:right; }
  .meta div { margin-bottom:3px; }
  .meta b { font-weight:normal; color:#6A736F; }
  table { width:100%; border-collapse:collapse; margin-top:28px; }
  th { font-family: Helvetica, Arial, sans-serif; font-size:8pt; letter-spacing:.09em;
       text-transform:uppercase; color:#6A736F; font-weight:normal; text-align:left;
       border-bottom:1px solid #14181A; padding:0 8px 6px 0; }
  td { padding:11px 8px 11px 0; border-bottom:1px solid #DEDFDB; vertical-align:top; }
  .num { text-align:right; font-variant-numeric: tabular-nums; white-space:nowrap; }
  .desc { color:#5C6663; font-size:9.5pt; }
  .totals { margin-top:14px; margin-left:auto; width:250px; }
  .totals div { display:flex; justify-content:space-between; padding:5px 0; }
  .totals .grand { border-top:1px solid #14181A; margin-top:5px; padding-top:9px; font-size:12.5pt; }
  .notes { margin-top:34px; padding-top:14px; border-top:1px solid #DEDFDB; font-size:9.5pt; color:#5C6663; }
  .notes li { margin-bottom:4px; }
  .foot { margin-top:30px; font-size:9pt; color:#8B9491; }
  </style></head><body>

  <div class="row">
    <div class="col">
      <div class="mark">Cleo</div>
      <div class="sub">Cleo Couture LLC</div>
    </div>
    <div class="col meta">
      <div style="font-size:14pt; letter-spacing:.08em;">PURCHASE ORDER</div>
      <div style="margin-top:8px"><b>No.</b> ${po.poNumber}</div>
      <div><b>Date</b> ${po.date}</div>
      ${po.expected ? `<div><b>Expected</b> ${po.expected}</div>` : ''}
    </div>
  </div>

  <hr class="rule">

  <div class="row">
    <div class="col">
      <h2>Vendor</h2>
      <div>${po.vendor.name}</div>
      ${po.vendor.attn ? `<div>Attn: ${po.vendor.attn}</div>` : ''}
      ${(po.vendor.lines || []).map((l) => `<div>${l}</div>`).join('')}
    </div>
    <div class="col">
      <h2>Deliver to</h2>
      ${po.deliverTo.map((l) => `<div>${l}</div>`).join('')}
    </div>
    <div class="col">
      <h2>Bill to</h2>
      ${po.billTo.map((l) => `<div>${l}</div>`).join('')}
    </div>
  </div>

  <table>
    <thead><tr>
      <th style="width:52%">Item</th>
      <th class="num">Qty</th>
      <th class="num">Unit</th>
      <th class="num">Price</th>
      <th class="num">Amount</th>
    </tr></thead>
    <tbody>
      ${lines.map((l) => `<tr>
        <td><div>${l.name}</div>${l.description ? `<div class="desc">${l.description}</div>` : ''}</td>
        <td class="num">${qty(l.qty)}</td>
        <td class="num">${l.unit}</td>
        <td class="num">${money(l.unitCostCents)}</td>
        <td class="num">${money(l.total)}</td>
      </tr>`).join('')}
    </tbody>
  </table>

  <div class="totals">
    <div class="grand"><span>Total</span><span class="num">${money(subtotal)}</span></div>
  </div>

  ${po.notes?.length ? `<div class="notes"><h2>Notes</h2><ul>${po.notes.map((n) => `<li>${n}</li>`).join('')}</ul></div>` : ''}

  <div class="foot">Please confirm receipt and expected ship date.<br>
  ${po.contact.name} &middot; ${po.contact.email} &middot; ${po.contact.phone}</div>
  </body></html>`
}

const spec = JSON.parse(readFileSync(process.argv[2], 'utf8'))
mkdirSync('out', { recursive: true })
const base = path.resolve('out', `PO-${spec.poNumber}`)
writeFileSync(base + '.html', html(spec))
execFileSync(CHROME, [
  '--headless=new', '--disable-gpu', '--no-pdf-header-footer',
  `--print-to-pdf=${base}.pdf`, 'file://' + base + '.html',
], { stdio: 'ignore' })
console.log('wrote ' + base + '.pdf')
