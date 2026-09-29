import type { MetadataRoute } from 'next'

/**
 * Makes the app installable, which is what turns a link into something with an
 * icon on a home screen. A phone opened from a personal link gets its own copy
 * with that person's key in start_url instead: see app/api/manifest/route.ts.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Cleo Camp Studio',
    short_name: 'Studio',
    description: 'Studio Mouse — the Cleo Camp studio assistant.',
    start_url: '/',
    display: 'standalone',
    background_color: '#FAFAF8',
    theme_color: '#FAFAF8',
    icons: [
      { src: '/icon.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/apple-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  }
}
