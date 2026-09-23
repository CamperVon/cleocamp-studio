import { Nav } from '@/app/ui/nav'
import { ScrollFrame } from '@/app/ui/scroll-frame'

export default function MainLayout({ children }: LayoutProps<"/">) {
  return (
    // Phone: a fixed frame, h-dvh, with the header at the top, the tab bar at
    // the bottom and only the page between them scrolling. The tab bar used to
    // be position: fixed over a scrolling page, and iPhone Safari drew it
    // halfway up the screen mid-scroll while its own toolbar was collapsing
    // (Brandon, 23 Sept 2026: "Footer should not float"). As an ordinary
    // flex child it has nowhere to drift to. Desktop keeps the normal
    // page scroll.
    <div className="flex h-dvh flex-col md:h-auto md:flex-1">
      <Nav />
      <ScrollFrame>{children}</ScrollFrame>
    </div>
  )
}
