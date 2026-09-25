'use client'
import { useEffect, useRef, useState } from 'react'

/**
 * Getting the PDF off a phone.
 *
 * A plain download link (Content-Disposition: attachment) does nothing when
 * the app is opened from the home screen on an iPhone — there is no download
 * bar to put the file in, so the tap goes nowhere. Brandon, 23 Sept 2026:
 * "I can't get PO pdfs to download on phone." Where the phone can share a
 * file, this hands the PDF to the share sheet instead — Save to Files, Mail,
 * Messages, AirDrop. A desktop browser still downloads it as before.
 *
 * The PDF is fetched when the page opens, not on tap: iOS only allows the
 * share sheet straight after a tap, and waiting a few seconds for the PDF to
 * render in between loses that permission.
 *
 * Phones only. Desktop Chrome and Safari can share files too, so testing for
 * that alone swapped the Mac's download for a share menu — Brandon, 25 Sept
 * 2026: "trying to download a pdf from desktop is a mess, i can't download it
 * from any browser". A touch screen is what marks the phone here.
 */
export function PdfButton({ poNumber }: { poNumber: string }) {
  const file = useRef<File | null>(null)
  const [canShare, setCanShare] = useState(false)
  const [state, setState] = useState<'idle' | 'working' | 'failed'>('idle')

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.canShare) return
    if (!window.matchMedia('(pointer: coarse)').matches) return
    let cancelled = false
    fetch(`/po/${poNumber}/pdf?inline=1`)
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((b) => {
        const f = new File([b], `PO-${poNumber}.pdf`, { type: 'application/pdf' })
        if (!cancelled && navigator.canShare({ files: [f] })) {
          file.current = f
          setCanShare(true)
        }
      })
      .catch(() => { /* the plain link below still works */ })
    return () => { cancelled = true }
  }, [poNumber])

  async function share() {
    if (!file.current) return
    setState('working')
    try {
      await navigator.share({ files: [file.current], title: `PO ${poNumber}` })
      setState('idle')
    } catch (e) {
      // Closing the sheet without picking anything is not a failure.
      if (e instanceof DOMException && e.name === 'AbortError') { setState('idle'); return }
      // Anything else: open the PDF itself, where the phone's own viewer has
      // a share button of its own.
      // A PDF from a route handler, not a Next page — a full load is the point.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(`${window.location.origin}/po/${poNumber}/pdf?inline=1`)
    }
  }

  const cls =
    'rounded border border-[#14181A]/20 px-3 py-1.5 font-sans text-[9pt] text-[#14181A] no-underline hover:bg-black/5'
  return canShare ? (
    <button type="button" onClick={share} disabled={state === 'working'} className={cls}>
      Save or send PDF
    </button>
  ) : (
    <a href={`/po/${poNumber}/pdf`} className={cls}>
      Download PDF
    </a>
  )
}
