import Link from "next/link";
import type { Metadata } from "next";
import { LandingNav } from "../landing/nav";
import { PersonaImage } from "./persona-image";

export const metadata: Metadata = {
  title: "About — Vellar",
  description:
    "About Vellar — the agent-payments stack for Stellar, built on x402 and secured by passkeys, and the person building it.",
};

export default function About() {
  return (
    <div className="landing-root">
      <LandingNav />

      <main className="about">
        <div className="wrap">
          {/* Intro */}
          <section className="about-hero">
            <span className="eyebrow">About</span>
            <h1>The agent-payments stack for Stellar.</h1>
            <p>
              Vellar is building on <a href="https://x402.org">x402</a>, the open protocol that
              turns HTTP 402 into machine-payable APIs. AI agents need to pay for the services they
              use — and nobody should have to hand an agent their keys to make that possible. So we
              build every layer on Stellar: scoped agent keys with budgets enforced by on-chain
              policy contracts, the first x402 client for Stellar smart accounts, an open-source
              facilitator that verifies and settles the payments, and a trust-ranked Bazaar so
              agents discover and pay the right services.
            </p>
            <p>
              Underneath it all is a self-custodial passkey smart wallet. You sign in with Face ID,
              Touch ID or a security key — no seed phrases — and your account is a smart contract
              enforcing real on-chain rules: spending limits, co-signers, allow-lists. Web-first,
              with a browser extension for Stellar dApps and a developer SDK, designed so the secure
              default is the only default — no silent signing, no key custody, fees sponsored.
            </p>
          </section>

          {/* Persona */}
          <section className="about-persona">
            {/* Upload your photo to apps/web/public/persona.jpg to replace the
                initials placeholder below. */}
            <div className="persona-photo">
              <PersonaImage />
            </div>
            <div className="persona-body">
              <span className="eyebrow">Who&apos;s building it</span>
              <h2>David Ejere</h2>
              <p className="persona-role mono">Founder &amp; builder</p>
              <p>
                I&apos;m building Vellar so that money on Stellar works for both people and their
                agents — no seed phrases to lose, no blind signing, and budgets the network enforces
                rather than a promise in the UI. Vellar started as a passkey wallet and is growing
                into the agent-payments stack on x402 that other Stellar developers can build on.
              </p>
              <div className="persona-links">
                <a
                  href="https://github.com/Vellar-Wallet"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  GitHub
                </a>
                <a href="mailto:hello@vellar.xyz">hello@vellar.xyz</a>
              </div>
            </div>
          </section>

          <div className="about-back">
            <Link href="/" className="btn btn-glass">
              ← Back to Vellar
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
