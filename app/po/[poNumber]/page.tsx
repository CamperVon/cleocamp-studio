import { notFound } from 'next/navigation'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * The purchase order document, rendered from the database.
 *
 * Same design as the PDFs sent to RichLine on 1 September — Cleo wordmark,
 * three address blocks, line items carrying the vendor's own style number, and
 * notes that say what needs confirming. Print to PDF from the browser; that
 * keeps one template rather than a script and a page drifting apart.
 */
const money = (c: number) =>
  '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default async function PurchaseOrderDoc({
  params,
}: {
  params: Promise<{ poNumber: string }>
}) {
  const { poNumber } = await params
  const po = await db.purchaseOrder.findFirst({
    where: { poNumber },
    include: {
      vendor: true, forProduct: true,
      lines: { include: { component: true, productVariant: { include: { product: true, colorway: true } } } },
    },
  })
  if (!po) notFound()

  const total = po.lines.reduce((n, l) => n + Number(l.qtyOrdered) * (l.unitCostCents ?? 0), 0)
  const date = (po.orderedAt ?? po.createdAt).toLocaleDateString('en-US', {
    timeZone: 'America/Los_Angeles', month: 'long', day: 'numeric', year: 'numeric',
  })

  // Brandon, 4 Sept 2026: "notes at the end of pdf should only be notes i
  // sent, not an endless list of things SM puts there." A generic per-line
  // "please confirm pricing" made sense for a handful of fabric lines with
  // different prices; on an 18-line uniform-price cut-and-sew order it was
  // the same sentence eighteen times, drowning the one real note. Notes is
  // now exactly what was actually written — nothing synthesized. Payment
  // terms is a real fact still worth printing, so it moved to the header,
  // its own line, not folded into "notes".
  const notes: string[] = po.notes ? [po.notes] : []

  return (
    <main className="mx-auto max-w-[8.5in] bg-white px-10 py-12 font-serif text-[11pt] leading-relaxed text-[#14181A] print:px-0 print:py-0">
      <style>{`@page { size: letter; margin: 0.85in 0.8in; } @media print { .no-print { display: none } }`}</style>

      <div className="flex items-start justify-between gap-8">
        <div>
          <div className="font-serif text-[22pt] italic tracking-[0.14em]">Cleo</div>
          <div className="mt-1.5 text-[8.5pt] uppercase tracking-[0.09em] text-[#6A736F]">
            Cleo Couture LLC
          </div>
        </div>
        <div className="text-right">
          <div className="text-[14pt] tracking-[0.08em]">PURCHASE ORDER</div>
          <div className="mt-2 tabular-nums">
            <span className="text-[#6A736F]">No. </span>{po.poNumber}
          </div>
          {po.forProduct ? (
            <div><span className="text-[#6A736F]">For </span>{po.forProduct.name}</div>
          ) : null}
          <div><span className="text-[#6A736F]">Date </span>{date}</div>
          {po.expectedAt ? (
            <div>
              <span className="text-[#6A736F]">Expected </span>
              {po.expectedAt.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' })}
            </div>
          ) : null}
          {po.paymentTerms ? (
            <div><span className="text-[#6A736F]">Terms </span>{po.paymentTerms}</div>
          ) : null}
          {po.status === 'DRAFT' ? (
            <div className="mt-1 text-[9pt] uppercase tracking-wider text-[#8C3A2B]">Draft — not sent</div>
          ) : null}
        </div>
      </div>

      <hr className="my-5 border-t border-[#14181A]" />

      <div className="flex justify-between gap-7">
        {[
          // The registered name, not Cleo's own name for them — this goes
          // to the vendor, and "Antonio's" means nothing on Antonio's own
          // letterhead. legalName is exactly what a formal document needs;
          // fall back to name only if it was never given one.
          ['Vendor', [po.vendor.legalName ?? po.vendor.name, po.vendor.contactName ? `Attn: ${po.vendor.contactName}` : '', po.vendor.address ?? '']],
          // Brandon, 4 Sept 2026: "Deliver to" read as confusing when it's
          // the same address as the vendor block — a cut-and-sew order's
          // finished goods often go right back to the maker's own address,
          // and the two side by side looked like a mistake, not a fact.
          ['Address', (po.deliverTo ?? '').split('\n')],
          ['Bill to', ['Cleo Couture LLC', '1667 North Main St', 'Los Angeles, CA 90012']],
        ].map(([label, lines]) => (
          <div key={label as string} className="flex-1">
            <h2 className="mb-1.5 font-sans text-[8.5pt] uppercase tracking-[0.11em] text-[#6A736F]">
              {label as string}
            </h2>
            {(lines as string[]).filter(Boolean).map((l, i) => <div key={i}>{l}</div>)}
          </div>
        ))}
      </div>

      <table className="mt-7 w-full border-collapse">
        <thead>
          <tr className="border-b border-[#14181A] text-left font-sans text-[8pt] uppercase tracking-[0.09em] text-[#6A736F]">
            <th className="w-1/2 pb-1.5 pr-2 font-normal">Item</th>
            <th className="pb-1.5 pr-2 text-right font-normal">Qty</th>
            <th className="pb-1.5 pr-2 text-right font-normal">Unit</th>
            <th className="pb-1.5 pr-2 text-right font-normal">Price</th>
            <th className="pb-1.5 text-right font-normal">Amount</th>
          </tr>
        </thead>
        <tbody>
          {po.lines.map((l) => (
            <tr key={l.id} className="border-b border-[#DEDFDB] align-top">
              <td className="py-2.5 pr-2">
                {l.component ? (
                  <>
                    <div>
                      {l.component.vendorSku ? `Style ${l.component.vendorSku} — ` : ''}
                      {l.component.vendorDescription ?? l.component.name}
                    </div>
                    {l.component.spec ? (
                      <div className="text-[9.5pt] text-[#5C6663]">{l.component.spec}</div>
                    ) : null}
                  </>
                ) : (
                  <div className="flex items-start gap-2.5">
                    {l.productVariant!.imageUrl ? (
                      // Plain img, not next/image — this page is rendered to a
                      // PDF (screenshot or print), where next/image's runtime
                      // optimisation endpoint has nothing to serve from.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={l.productVariant!.imageUrl}
                        alt=""
                        className="h-9 w-9 shrink-0 rounded object-cover"
                      />
                    ) : null}
                    <div>
                      {l.productVariant!.sku ? `Style ${l.productVariant!.sku} — ` : ''}
                      {l.productVariant!.product.name}
                      {l.productVariant!.colorway ? ` — ${l.productVariant!.colorway.customerName}` : ''}
                      {l.productVariant!.size ? ` / ${l.productVariant!.size}` : ''}
                    </div>
                  </div>
                )}
              </td>
              <td className="py-2.5 pr-2 text-right tabular-nums">{Number(l.qtyOrdered).toLocaleString()}</td>
              <td className="py-2.5 pr-2 text-right">{l.unit}</td>
              <td className="py-2.5 pr-2 text-right tabular-nums">{l.unitCostCents ? money(l.unitCostCents) : '—'}</td>
              <td className="py-2.5 text-right tabular-nums">
                {money(Number(l.qtyOrdered) * (l.unitCostCents ?? 0))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="ml-auto mt-3.5 w-[250px]">
        <div className="flex justify-between border-t border-[#14181A] pt-2 text-[12.5pt]">
          <span>Total</span>
          <span className="tabular-nums">{money(total)}</span>
        </div>
      </div>

      {notes.length ? (
        <div className="mt-8 border-t border-[#DEDFDB] pt-3.5 text-[9.5pt] text-[#5C6663]">
          <h2 className="mb-1.5 font-sans text-[8.5pt] uppercase tracking-[0.11em] text-[#6A736F]">Notes</h2>
          <ul className="list-disc pl-5">
            {notes.map((n, i) => <li key={i} className="mb-1">{n}</li>)}
          </ul>
        </div>
      ) : null}

      <div className="mt-7 text-[9pt] text-[#8B9491]">
        Please confirm receipt and expected ship date.<br />
        Brandon Camp &middot; brandon@cleocamp.com &middot; 310-622-3898
      </div>

      <div className="no-print mt-10 flex items-center gap-3 border-t border-[#DEDFDB] pt-4 text-[9pt] text-[#8B9491]">
        <a
          href={`/po/${po.poNumber}/pdf`}
          className="rounded border border-[#14181A]/20 px-3 py-1.5 font-sans text-[9pt] text-[#14181A] no-underline hover:bg-black/5"
        >
          Download PDF
        </a>
        <span>or print this page from your browser.</span>
      </div>
    </main>
  )
}
