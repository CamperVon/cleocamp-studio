'use server'
import { redirect } from 'next/navigation'
import { createSession, destroySession, passwordMatches } from '@/lib/session'

export async function signIn(_prev: string | null, formData: FormData) {
  const password = String(formData.get('password') ?? '')
  const next = String(formData.get('next') ?? '/')

  if (!passwordMatches(password)) {
    return 'That password is not right. Try again.'
  }
  await createSession()
  redirect(next.startsWith('/') ? next : '/')
}

export async function signOut() {
  await destroySession()
  redirect('/login')
}
