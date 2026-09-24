import { MouseFace } from './mouse-face'

/**
 * Echoes Cleo's own wordmark — italic serif, wide tracking, nothing shouting.
 */
export function Wordmark({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  const lg = size === 'lg'
  return (
    <span className="inline-flex items-center gap-2.5">
      <MouseFace size={lg ? 52 : 30} />
      <span
        className={`font-serif italic text-ink ${lg ? 'text-3xl' : 'text-lg'}`}
        style={{ letterSpacing: lg ? '0.16em' : '0.11em' }}
      >
        Studio Mouse
      </span>
    </span>
  )
}
