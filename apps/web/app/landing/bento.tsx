import type { ReactNode } from "react";
import { Chips, Field, MonoRow, MonoRows, SectionHead } from "./ui";

// `area` maps each feature onto its named slot in the bento grid
// (see .lp-bento in landing.css); `extra` is optional tile flourish.
type Feature = {
  title: string;
  body: string;
  icon: ReactNode;
  area: string;
  extra?: ReactNode;
};

const FEATURES: Feature[] = [
  {
    title: "Instant DEX swaps",
    body: "Trade Stellar assets natively without leaving your wallet, settled on-chain in seconds.",
    icon: <path d="M7 8h10M7 8l3-3M17 16H7m10 0l-3 3" />,
    area: "swaps",
  },
  {
    title: "Programmable policies",
    body: "Spending limits, co-signers, time locks and allow-lists, enforced by the network, not a promise.",
    icon: <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" />,
    area: "policies",
    extra: (
      <Chips
        items={[
          { label: "Spend limit" },
          { label: "Co-signers" },
          { label: "Time locks" },
          { label: "Allow-lists" },
        ]}
      />
    ),
  },
  {
    title: "Contract verification",
    body: "See exactly what a contract does before you sign. Vellar flags what's verified and what's risky.",
    icon: (
      <>
        <path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6l7-3z" />
        <path d="M9 12l2 2 4-4" />
      </>
    ),
    area: "verify",
  },
  {
    title: "Sponsored fees",
    body: "Vellar sponsors network fees on everyday transactions, no need to hold XLM just to get started.",
    icon: (
      <>
        <rect x="5" y="3" width="14" height="18" rx="2" />
        <path d="M9 8h6M9 12h6M9 16h4" />
      </>
    ),
    area: "fees",
  },
  {
    title: "Passkey security",
    body: "Unlock with Face ID, Touch ID or a security key. Keys live in your device's secure enclave, nothing to write down, nothing to leak.",
    icon: <path d="M9 11a4 4 0 118 0c0 3-3 4-3 4M13 20h.01M12 3a9 9 0 100 18" />,
    area: "passkey",
    extra: (
      <>
        <Field
          label="SIGN REQUEST"
          amount="Send 166.6 XLM"
          amountStyle={{ fontSize: 18 }}
          sub={
            <>
              <span>swap.stellar.app</span>
              <span>✓ passkey confirmed</span>
            </>
          }
        />
        <Chips items={[{ label: "Face ID" }, { label: "Touch ID" }, { label: "Security key" }]} />
      </>
    ),
  },
  {
    title: "Guided account cleanup",
    body: "Reclaim locked reserves from unused trustlines and stale entries. Every step is laid out for you to review and sign. Closing an account moves its funds and can't be undone.",
    icon: (
      <>
        <path d="M4 7l8-4 8 4-8 4-8-4z" />
        <path d="M4 12l8 4 8-4M4 17l8 4 8-4" />
      </>
    ),
    area: "cleanup",
  },
  {
    title: "Non-custodial",
    body: "Your account and keys live on Stellar and in your enclave. We never touch your funds.",
    icon: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="3" />
        <path d="M3 10h18" />
      </>
    ),
    area: "custody",
  },
  {
    title: "Trust signals",
    body: "Every signature comes with a plain-language breakdown and a risk score before you approve.",
    icon: (
      <>
        <rect x="4" y="4" width="7" height="7" rx="2" />
        <rect x="13" y="4" width="7" height="7" rx="2" />
        <rect x="4" y="13" width="7" height="7" rx="2" />
        <rect x="13" y="13" width="7" height="7" rx="2" />
      </>
    ),
    area: "trust",
  },
  {
    title: "Developer SDK",
    body: "Ship passkey auth, policies and contract-verification tooling into your own Stellar app.",
    icon: <path d="M8 9l-4 3 4 3M16 9l4 3-4 3M13 6l-2 12" />,
    area: "sdk",
    extra: (
      <div className="tcode">
        <MonoRows>
          <MonoRow label="$ npm install vellar-sdk" />
          <MonoRow label="await vellar.x402.fetch(url)" value="✓ paid" tone="ok" />
        </MonoRows>
      </div>
    ),
  },
];

/** "Wallet services" — the asymmetric bento grid. */
export function WalletServices() {
  return (
    <section className="lp-sec" id="features">
      <div className="lp-wrap">
        <SectionHead
          eyebrow="Wallet services"
          title={
            <>
              Everything a smart wallet <em>should</em> do.
            </>
          }
          lead="Agents are only half the story. Vellar is a full self-custodial smart wallet for people too, with passkeys, programmable policies and trust signals layered over your Stellar account. No custody, no compromises."
        />
        <div className="lp-bento" data-reveal-group>
          {FEATURES.map((f) => (
            <div className={`lp-tile lp-tile--${f.area}`} key={f.title}>
              <div className="ico">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  {f.icon}
                </svg>
              </div>
              <h4>{f.title}</h4>
              <p>{f.body}</p>
              {f.extra}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
