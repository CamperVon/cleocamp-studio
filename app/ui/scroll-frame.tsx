'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState, useTransition, type ReactNode } from 'react'

/**
 * The phone's scrolling middle, between the header and the tab bar — with
 * pull-to-refresh put back by hand.
 *
 * Safari only offers pull-to-refresh when the window itself scrolls. Since
 * the tab bar stopped floating (23 Sept 2026) only this box scrolls, so
 * Brandon's pull-down stopped refreshing. Pulling from the top of this box
 * now does it instead: past the threshold it re-fetches the page from the
 * server (router.refresh), which picks up new numbers without wiping a
 * half-typed message to Mouse the way a full reload would.
 */
const THRESHOLD = 64

export function ScrollFrame({ children }: { children: ReactNode }) {
  const router = useRouter()
  const ref = useRef<HTMLDivElement>(null)
  const startY = useRef<number | null>(null)
  const [pull, setPull] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [refreshing, startRefresh] = useTransition()

  const onTouchStart = (e: React.TouchEvent) => {
    // Only a pull from the very top counts — and not one that starts inside
    // something with its own scroll (Mouse's message list) that is scrolled
    // down, where swiping down means "show me earlier messages".
    let atTop = (ref.current?.scrollTop ?? 1) <= 0
    for (let el = e.target as HTMLElement | null; atTop && el && el !== ref.current; el = el.parentElement) {
      if (el.scrollTop > 0) atTop = false
    }
    startY.current = atTop ? e.touches[0].clientY : null
    setDragging(startY.current !== null)
  }
  const onTouchMove = (e: React.TouchEvent) => {
    if (startY.current === null) return
    const dy = e.touches[0].clientY - startY.current
    // Damped, so it feels like a pull rather than a drag.
    setPull(dy > 0 ? Math.min(dy * 0.5, THRESHOLD * 1.5) : 0)
  }
  const onTouchEnd = () => {
    if (startY.current !== null && pull >= THRESHOLD) startRefresh(() => router.refresh())
    startY.current = null
    setDragging(false)
    setPull(0)
  }

  const shown = refreshing ? 40 : pull
  return (
    <div
      ref={ref}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
      className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain md:overflow-visible"
    >
      <div
        aria-hidden={!refreshing}
        className="flex shrink-0 items-end justify-center overflow-hidden text-xs text-faint md:hidden"
        style={{ height: shown, transition: dragging ? 'none' : 'height 150ms ease-out' }}
      >
        <span className="pb-2">
          {refreshing ? 'Refreshing…' : pull >= THRESHOLD ? 'Let go to refresh' : 'Pull to refresh'}
        </span>
      </div>
      {children}
    </div>
  )
}
