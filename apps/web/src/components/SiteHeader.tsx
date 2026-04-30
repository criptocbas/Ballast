import Link from 'next/link';
import { Logo } from './Logo';

const NAV_ITEMS: ReadonlyArray<{ href: string; label: string }> = [
  { href: '/vault', label: 'Vault' },
  { href: '/me', label: 'You' },
  { href: '/dx', label: 'DX log' },
  { href: '/about', label: 'About' },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-[var(--border)] bg-[var(--bg)]/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
        <Link href="/" className="flex items-center gap-2.5 text-fg" aria-label="Ballast home">
          <Logo className="h-5 w-5 text-[var(--accent)]" />
          <span className="text-[15px] font-semibold tracking-tight">Ballast</span>
          <span className="hidden sm:inline-block text-[11px] uppercase tracking-[0.18em] font-medium text-[var(--fg-muted)] border border-[var(--border)] rounded px-1.5 py-0.5 ml-2">
            alpha
          </span>
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="px-3 py-2 text-[var(--fg-dim)] hover:text-fg rounded-md hover:bg-[var(--bg-elev)] transition-colors"
            >
              {item.label}
            </Link>
          ))}
          <Link
            href="/deposit"
            className="ml-2 inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-3.5 py-2 text-sm font-medium text-white hover:bg-[var(--accent)]/90 transition-colors"
          >
            Deposit
          </Link>
        </nav>
      </div>
    </header>
  );
}
