import Link from 'next/link';

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-[var(--border)]">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-10 text-sm text-[var(--fg-dim)] sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="font-medium text-fg">Ballast</span>
          <span className="text-[var(--fg-muted)]">·</span>
          <span>Built for Solana Frontier Hackathon · Jupiter sidetrack</span>
        </div>
        <div className="flex items-center gap-5">
          <Link
            href="https://github.com/criptocbas/Ballast"
            className="hover:text-fg transition-colors"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </Link>
          <Link
            href="https://developers.jup.ag"
            className="hover:text-fg transition-colors"
            target="_blank"
            rel="noreferrer"
          >
            Powered by Jupiter
          </Link>
        </div>
      </div>
    </footer>
  );
}
