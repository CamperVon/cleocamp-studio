import { PdfButton } from '@/app/po/[poNumber]/pdf-button'
import { howToRead, partnerReference } from '@/lib/style-reference'

export const dynamic = 'force-dynamic'

/**
 * The style number reference for partners (8 Oct 2026): printable, read only,
 * confirmed styles and codes only (lib/style-reference.ts). Behind the app's
 * sign-in like every page; nothing here is public. A copy goes to a partner
 * as the PDF, once Brandon has looked it over.
 */
export default async function StyleReference() {
  const { categories, example } = await partnerReference()
  return (
    <main className="mx-auto max-w-[8.5in] bg-white px-5 py-8 font-serif text-[11pt] leading-relaxed text-[#14181A] sm:px-10 sm:py-12 print:px-0 print:py-0">
      <style>{`@page { size: letter; margin: 0.8in; } @media print { .no-print { display: none } }`}</style>
      <div className="font-serif text-[22pt] italic tracking-[0.14em]">Cleo</div>
      <div className="mt-1 text-[8.5pt] uppercase tracking-[0.09em] text-[#6A736F]">Cleo Couture LLC · Style numbers</div>
      <hr className="my-5 border-t border-[#14181A]" />

      <h2 className="mb-1.5 font-sans text-[8.5pt] uppercase tracking-[0.11em] text-[#6A736F]">How to read a SKU</h2>
      <ul className="mb-6 list-disc pl-5">
        {howToRead(example).map((l, i) => <li key={i} className="mb-1">{l}</li>)}
      </ul>

      {categories.map((c) => (
        <section key={c.code} className="mb-6 break-inside-avoid">
          <h2 className="mb-1.5 border-b border-[#14181A] pb-1 font-sans text-[8.5pt] uppercase tracking-[0.11em] text-[#6A736F]">{c.code} · {c.name}</h2>
          <ul>
            {c.styles.map((s) => (
              <li key={s.number} className="border-b border-[#DEDFDB] py-2">
                <div><span className="tabular-nums font-medium">{s.number}</span> {s.name}</div>
                <div className="text-[9.5pt] text-[#5C6663]">
                  Colours: {s.colours.length ? s.colours.map((x) => `${x.code} ${x.name}`).join(' · ') : 'to be confirmed'}
                </div>
                <div className="text-[9.5pt] text-[#5C6663]">
                  Sizes: {s.sizes.length ? s.sizes.map((x) => `${x.code}${x.code === x.name ? '' : ` ${x.name}`}`).join(' · ') : 'to be confirmed'}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <div className="no-print mt-10 flex flex-wrap items-start gap-5 border-t border-[#DEDFDB] pt-4 text-[9pt] text-[#8B9491]">
        <PdfButton path="/styles/pdf" name="Cleo-Camp-style-numbers" />
        <span>or print this page from your browser. Confirmed styles only; proposed ones are left off until Brandon or Cleo confirm them.</span>
      </div>
    </main>
  )
}
