import Image from 'next/image'

/**
 * Studio Mouse as Brandon had it drawn (24 Sept 2026): the pink pom-pom mouse
 * with the disco ball. This is the face, cropped round, for anywhere Mouse
 * speaks — the chat, Mouse's Corner, the header. The full illustration is
 * /mouse/studio-mouse.jpg (sign-in, the Daily Cheese).
 *
 * Team-facing only. Nothing a customer receives carries Mouse — replies go
 * out as Cleo Studio (Brandon: "def not customer support").
 */
export function MouseFace({ size = 32, className = '' }: { size?: number; className?: string }) {
  return (
    <Image
      src="/mouse/face.jpg"
      alt=""
      aria-hidden
      width={size}
      height={size}
      className={`shrink-0 rounded-full ${className}`}
    />
  )
}
