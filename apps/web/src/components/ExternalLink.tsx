import Link from 'next/link';

interface ExternalLinkProps {
  href: string;
  className?: string;
  children: React.ReactNode;
}

export function ExternalLink({ href, className = '', children }: ExternalLinkProps) {
  return (
    <Link
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className={`inline-flex items-center gap-1.5 text-[var(--fg-dim)] hover:text-fg transition-colors ${className}`}
    >
      {children}
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="h-3.5 w-3.5"
      >
        <path d="M6 3h7v7" />
        <path d="M13 3L4 12" />
      </svg>
    </Link>
  );
}
