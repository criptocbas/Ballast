import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import './wallet-overrides.css';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { WalletProviders } from '@/components/WalletProviders';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: {
    default: 'Ballast — Yield with a built-in tail-risk hedge',
    template: '%s · Ballast',
  },
  description:
    'A USDC vault where Jupiter Lend yield finances NO-contract hedges on tail-risk prediction markets. Built for the Solana Frontier Hackathon.',
  applicationName: 'Ballast',
  authors: [{ name: 'Ballast' }],
};

export const viewport: Viewport = {
  themeColor: '#0a0a0b',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <WalletProviders>
          <SiteHeader />
          <main className="flex-1 flex flex-col">{children}</main>
          <SiteFooter />
        </WalletProviders>
      </body>
    </html>
  );
}
