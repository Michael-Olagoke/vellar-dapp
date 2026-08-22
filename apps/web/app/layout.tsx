import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Providers } from "./providers";
import "./globals.css";

const title = "Vellar, the agent-payments stack for Stellar, built on x402";
const description =
  "Give your agent a budget, not your keys. Smart accounts that pay x402 APIs autonomously, with budgets enforced on-chain, on a passkey smart wallet with programmable policies and contract trust signals. No seed phrases.";

export const metadata: Metadata = {
  title,
  description,
  openGraph: {
    title,
    description,
    siteName: "Vellar",
    type: "website",
  },
  twitter: {
    card: "summary",
    title,
    description,
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Clash Display: app shell. Cabinet Grotesk: landing display face. */}
        <link
          href="https://api.fontshare.com/v2/css?f[]=clash-display@700,600,500,400&f[]=cabinet-grotesk@800,700,500&display=swap"
          rel="stylesheet"
        />
        {/* Playfair italic is the landing's rationed emphasis face. */}
        <link
          href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@1,500;1,600;1,700&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Space+Mono:wght@400;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
