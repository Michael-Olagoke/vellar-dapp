import { Eyebrow } from "./ui";

const FAQS = [
  {
    q: "Can my AI agent spend from my wallet?",
    a: "Yes, that's what agent keys are for. Mint your agent a scoped session key with an on-chain spending limit and it can pay x402-enabled APIs autonomously, no passkey prompt needed. The budget is enforced by a policy contract inside your wallet, not by the agent's code. Go over it and the chain refuses to settle. Revoke the key at any time.",
  },
  {
    q: "Is Vellar custodial?",
    a: "No. Vellar is fully self-custodial, your account and keys live on Stellar and in your device's secure enclave. We never hold your funds or your passkeys.",
  },
  {
    q: "What happens if I lose my device?",
    a: "Register multiple passkeys across devices, and use account policies to add recovery co-signers. Losing one device doesn't lock you out, which is the whole point of moving past single seed phrases.",
  },
  {
    q: "Do I need the browser extension?",
    a: "Not to get started, Vellar is web-first. The extension is there when you want one-click connections to Stellar dApps with the same passkey and policies you've already set.",
  },
  {
    q: "What are programmable policies, exactly?",
    a: "On-chain rules enforced by the network: spending limits, required co-signers, time locks and allow-lists. They apply to every transaction automatically, so a compromised session still can't drain the account.",
  },
  {
    q: "Is it ready for teams and developers?",
    a: "Yes. Teams get multi-signer policies and shared controls; developers get an SDK, contract-verification tooling and the extension's connect API.",
  },
];

/** FAQ: aside + native details/summary accordion. */
export function FaqSection() {
  return (
    <section className="lp-sec" id="faq">
      <div className="lp-wrap lp-faq-grid">
        <div className="lp-faq-aside" data-reveal>
          <Eyebrow>Questions</Eyebrow>
          <h2 className="mt-[var(--lp-sp-4)]!">Frequently asked questions</h2>
          <p className="mt-[var(--lp-sp-4)]! text-[length:var(--lp-fs-sm)] leading-relaxed text-[var(--lp-ink-soft)]">
            Still curious? Reach us at <a href="mailto:hello@vellar.xyz">hello@vellar.xyz</a> or
            read the <a href="https://docs.vellar.xyz/">developer docs</a>.
          </p>
        </div>
        <div data-reveal-group>
          {FAQS.map((f) => (
            <details className="lp-fitem" key={f.q}>
              <summary>
                {f.q} <span className="pm">+</span>
              </summary>
              <div className="body">{f.a}</div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
