import type { Metadata } from "next";
import { LpShell } from "../landing/shell";
import { SdkCta } from "../landing/cta";
import { Chips, Eyebrow, Frame, LpButton } from "../landing/ui";
import { PersonaImage } from "./persona-image";

export const metadata: Metadata = {
  title: "About · Vellar",
  description:
    "About Vellar, the agent-payments stack for Stellar, built on x402 and secured by passkeys, and the person building it.",
};

export default function About() {
  return (
    <LpShell>
      {/* Intro */}
      <section className="lp-sec">
        <div className="lp-wrap">
          <div className="lp-sechead" data-reveal>
            <div>
              <Eyebrow>About</Eyebrow>
              <h1 data-split className="lp-about-title">
                The <em>agent-payments</em> stack for Stellar.
              </h1>
            </div>
            <p className="lp-lead">
              Vellar is building on <a href="https://x402.org">x402</a>, the open protocol that
              turns HTTP 402 into machine-payable APIs. AI agents need to pay for the services they
              use, and nobody should have to hand an agent their keys to make that possible. So we
              build every layer on Stellar.
            </p>
          </div>
          <div className="lp-about-layers" data-reveal-group>
            <div className="lp-about-layer">
              <span className="num">01</span>
              <h4>Agent keys</h4>
              <p>Scoped session keys with budgets enforced by on-chain policy contracts.</p>
            </div>
            <div className="lp-about-layer">
              <span className="num">02</span>
              <h4>x402 client</h4>
              <p>The first x402 client built for Stellar smart accounts, in the vellar-sdk.</p>
            </div>
            <div className="lp-about-layer">
              <span className="num">03</span>
              <h4>Facilitator</h4>
              <p>Open source, verifies and settles x402 payments on Stellar.</p>
            </div>
            <div className="lp-about-layer">
              <span className="num">04</span>
              <h4>Bazaar</h4>
              <p>Trust-ranked discovery so agents find and pay the right services.</p>
            </div>
          </div>
          <div className="lp-about-note" data-reveal>
            <p className="lp-lead">
              Underneath it all is a self-custodial passkey smart wallet: sign in with Face ID,
              Touch ID or a security key, and your account is a smart contract enforcing real
              on-chain rules.
            </p>
            <Chips
              items={[
                { label: "No seed phrases", on: true },
                { label: "No silent signing", on: true },
                { label: "No key custody", on: true },
                { label: "Fees sponsored", on: true },
              ]}
            />
          </div>
        </div>
      </section>

      {/* Persona */}
      <section className="lp-sec lp-sec--tight">
        <div className="lp-wrap">
          <div
            className="grid grid-cols-1 gap-[var(--lp-sp-8)] md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:items-center"
            data-reveal
          >
            {/* Upload a photo to apps/web/public/about.jpg to replace the
                initials placeholder. */}
            <Frame className="max-w-[380px]">
              <div className="lp-persona">
                <PersonaImage />
              </div>
            </Frame>
            <div>
              <Eyebrow>Who&apos;s building it</Eyebrow>
              <h2 className="mt-[var(--lp-sp-3)]! text-[length:var(--lp-fs-h3)]!">David Ejere</h2>
              <p className="mt-[var(--lp-sp-2)]! text-[length:var(--lp-fs-eyebrow)] font-bold uppercase tracking-[0.14em] text-[var(--lp-ink-faint)]">
                Founder &amp; builder
              </p>
              <p className="lp-lead mt-[var(--lp-sp-4)]!">
                I&apos;m building Vellar so that money on Stellar works for both people and their
                agents, with no seed phrases to lose, no blind signing, and budgets the network
                enforces rather than a promise in the UI. Vellar started as a passkey wallet and is
                growing into the agent-payments stack on x402 that other Stellar developers can
                build on.
              </p>
              <div className="lp-cta-row">
                <LpButton href="https://github.com/Vellar-Wallet" variant="forest">
                  GitHub
                </LpButton>
                <LpButton href="mailto:hello@vellar.xyz" variant="outline">
                  hello@vellar.xyz
                </LpButton>
              </div>
            </div>
          </div>
        </div>
      </section>

      <SdkCta />
    </LpShell>
  );
}
