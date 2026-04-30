interface LogoProps {
  className?: string;
}

/**
 * Ballast mark — a plumb bob.
 *
 * A vertical line dropping to a filled circle: the simplest tool for finding
 * stable vertical, where gravity does the work. The most direct possible glyph
 * for what Ballast does.
 */
export function Logo({ className }: LogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <line x1="6" y1="3" x2="18" y2="3" />
      <line x1="12" y1="3" x2="12" y2="15" />
      <circle cx="12" cy="18" r="3" fill="currentColor" stroke="none" />
    </svg>
  );
}
