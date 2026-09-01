/**
 * Studio Mouse, drawn as a single delicate ink line.
 *
 * Cleo's own site is Times italic, wide tracking, a lot of quiet — so this is
 * a pen sketch rather than a mascot. What makes it read as a mouse at 30px is
 * the round ear and the long tail; everything else stays understated.
 */
export function Mouse({ className = '', size = 40 }: { className?: string; size?: number }) {
  return (
    <svg
      viewBox="0 0 80 46"
      width={size}
      height={(size * 46) / 80}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.3}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {/* body — snout at the right, rump at the left, one continuous line */}
      <path d="M67 29.5c-5.4-7.2-12.6-11.6-21.4-12.1-9.8-.6-19.6 2.7-25.2 8.6-3.3 3.5-2.6 8.3 1.9 10.2 4.6 2 11.4 2.3 18.3 1.4 10.3-1.3 20.3-4.4 26.4-8.1z" />
      {/* ear */}
      <path d="M46.4 17.4c-1.8-3.6-.6-7.7 2.8-9.2 3.5-1.5 7.6.4 8.9 4.2 1 2.9.1 5.9-2 7.6" />
      {/* eye */}
      <circle cx="60.2" cy="24.6" r="1.05" fill="currentColor" stroke="none" />
      {/* whiskers */}
      <path d="M67.6 28.3c3.1-1.5 6-2.5 8.6-3M68.4 30.6c2.9.2 5.6.7 7.9 1.6" strokeWidth={0.9} />
      {/* feet */}
      <path d="M50.2 37.3c.5 1.9.3 3.4-.5 4.4M33.4 37.9c.4 1.9.1 3.4-.8 4.3" strokeWidth={1} />
      {/* tail */}
      <path d="M21.3 36.2c-4.6 1.9-9.2 1.6-12.4-.9-3-2.4-3.2-6.3-.4-8.2 2.6-1.8 5.9-.5 6.2 2.2.2 2-1.4 3.3-3 2.9" strokeWidth={1} />
    </svg>
  )
}
