import { redirect } from 'next/navigation'

/** Moved to the Special tab (Brandon, 4 Oct 2026); an old link still lands there. */
export default function Waiting() {
  redirect('/special')
}
