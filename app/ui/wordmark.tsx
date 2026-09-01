import { Mouse } from './mouse'

/**
 * Echoes Cleo's own wordmark — italic serif, wide tracking, nothing shouting.
 */
export function Wordmark({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  const lg = size === 'lg'
  return (
    <span className="inline-flex items-center gap-2.5">
      <Mouse size={lg ? 52 : 30} className="text-ink/80" />
      <span
        className={`font-serif italic text-ink ${lg ? 'text-3xl' : 'text-lg'}`}
        style={{ letterSpacing: lg ? '0.16em' : '0.11em' }}
      >
        Studio Mouse
      </span>
    </span>
  )
}
