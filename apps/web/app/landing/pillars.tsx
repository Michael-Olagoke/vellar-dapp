import { LpButton, SectionHead } from "./ui";

const PILLARS = [
  {
    num: "01",
    title: "Agent keys with on-chain budgets",
    body: "One passkey tap mints your agent a scoped session key, locked to the tokens you choose, capped by a spending-limit policy. The budget lives in a contract, not in code the agent could bypass, and you can revoke the key remotely any time.",
  },
  {
    num: "02",
    title: "Autonomous payments via the SDK",
    body: "The first x402 client built for Stellar smart accounts. One call handles the 402 challenge, sign headlessly, pay, get the resource. An over-budget payment fails on-chain before any money moves.",
  },
  {
    num: "03",
    title: "Facilitator + trust-ranked Bazaar",
    body: "Our open-source facilitator verifies and settles x402 payments, including policy-governed smart accounts other facilitators reject, and its Bazaar lets agents discover payable APIs ranked by real settlement data and contract verification.",
  },
];

/** "Building on x402" — the three-pillar product story. */
export function X402Pillars() {
  return (
    <section className="lp-sec" id="agents">
      <div className="lp-wrap">
        <SectionHead
          eyebrow="Building on x402"
          title={
            <>
              The <em>agent-payments</em> stack for Stellar.
            </>
          }
          lead={
            <>
              <a href="https://x402.org">x402</a> is the open protocol that turns HTTP 402 into
              machine-payable APIs. We&apos;re building every layer of it on Stellar: the payer,
              smart accounts with scoped agent keys, the settlement rails, and trust-ranked
              discovery so agents pay the right services.
            </>
          }
        />
        <div className="lp-pillars" data-reveal-group>
          {PILLARS.map((p) => (
            <div className="lp-pillar" key={p.num}>
              <span className="num">{p.num}</span>
              <h4>{p.title}</h4>
              <p>{p.body}</p>
            </div>
          ))}
        </div>
        <div className="lp-cta-row" data-reveal>
          <LpButton href="https://docs.vellar.xyz/docs/agent-keys" variant="forest">
            Read the agent-keys guide
          </LpButton>
          <LpButton href="https://github.com/Vellar-Wallet/vellar-facilitator" variant="outline">
            Facilitator on GitHub
          </LpButton>
        </div>
      </div>
    </section>
  );
}
