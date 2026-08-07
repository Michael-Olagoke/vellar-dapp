import type { Metadata } from "next";
import type { ReactNode } from "react";
import { themeInitScript } from "@/lib/theme";
import { Providers } from "./providers";
import "./globals.css";

const title = "Vellar — the agent-payments stack for Stellar, built on x402";
const description =
  "Give your agent a budget, not your keys. Smart accounts that pay x402 APIs autonomously, with budgets enforced on-chain — on a passkey smart wallet with programmable policies and contract trust signals. No seed phrases.";

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
    // data-theme is rendered server-side (default dark) so it matches the
    // pre-paint script; suppressHydrationWarning covers the light-mode swap.
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://api.fontshare.com/v2/css?f[]=clash-display@700,600,500,400&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Space+Mono:wght@400;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
