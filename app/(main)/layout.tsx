import { Nav } from '@/app/ui/nav'

export default function MainLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <Nav />
      {/* Room at the bottom on a phone for the tab bar, so the last card on a
          page is never sitting underneath it. */}
      <div className="flex flex-1 flex-col pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-0">
        {children}
      </div>
    </>
  )
}
