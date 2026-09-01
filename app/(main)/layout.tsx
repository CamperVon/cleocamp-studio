import { Nav } from '@/app/ui/nav'

export default function MainLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <Nav />
      {children}
    </>
  )
}
