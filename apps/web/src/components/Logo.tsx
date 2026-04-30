interface LogoProps {
  className?: string;
}

/**
 * Reflux mark — a recursive-flow glyph hinting at "yield flows back to insurance".
 * The two intersecting arcs form a soft R that reads as a return / refund / reflow motion.
 */
export function Logo({ className }: LogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 3a9 9 0 1 1-9 9" />
      <path d="M12 7v5l3 2" />
      <path d="M3 12l2.5-2.5" />
      <path d="M3 12l2.5 2.5" />
    </svg>
  );
}
