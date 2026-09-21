import type { MetadataRoute } from 'next'

/**
 * Makes the app installable, which is what turns a link into something with an
 * icon on a home screen.
 *
 * `shortcuts` is the long-press menu Brandon described — press and hold the
 * icon, tap "Tell Mouse", start talking. Android honours it today. iOS honours
 * it for home-screen web apps from 16.4, and where it does not, the icon still
 * opens the app and the dictate screen is one tap away.
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
    shortcuts: [
      {
        name: 'Tell Mouse',
        short_name: 'Tell Mouse',
        description: 'Dictate an update without opening anything else',
        url: '/say',
      },
    ],
  }
}
