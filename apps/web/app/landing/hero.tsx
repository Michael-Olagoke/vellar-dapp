import { Chips, Field, Frame, LpButton, MonoRow, MonoRows, TokenPill } from "./ui";

const BAZAAR = [
  { name: "Weather API", meta: "0.05 USDC · verified" },
  { name: "Translate API", meta: "0.02 USDC · verified" },
  { name: "GPU Inference", meta: "0.25 USDC · 1.2k settlements" },
];

/** Landing hero: the statement headline plus the three product cards
 *  (agent key, autonomous payment, Bazaar). */
export function Hero() {
  return (
    <header className="lp-hero">
      <div className="lp-wrap">
        <h1 data-split>
          Give your agent a budget, <em>not your keys.</em>
        </h1>
        <p className="lp-lead" data-hero-fade>
          Vellar is building the agent-payments stack for Stellar on x402, smart accounts that pay
          HTTP-402 APIs autonomously, budgets enforced on-chain, and trust-ranked discovery. Secured
          by passkeys, not seed phrases.
        </p>
        <div className="lp-cta-row" data-hero-fade>
          <LpButton href="/app" variant="sun" size="lg">
            Launch web app →
          </LpButton>
          <LpButton href="https://docs.vellar.xyz/" variant="outline" size="lg">
            Build with the SDK
          </LpButton>
        </div>

        <div className="lp-hero-cards" data-reveal-group>
          <Frame>
            <div className="lp-pcard">
              <div className="lp-pcard-top">
                <span>Agent key</span>
                <span>◇</span>
              </div>
              <Field
                label="AGENT"
                amount="research-bot"
                amountStyle={{ fontSize: 18 }}
                token={<TokenPill usdc label="USDC" />}
                sub={
                  <>
                    <span>session key GDW3…K7QP</span>
                    <span>expires in 7d</span>
                  </>
                }
              />
              <Field
                label="BUDGET USED"
                amount="3.20"
                token={<TokenPill usdc label="/ 25 USDC" />}
                sub={
                  <>
                    <span>12 payments</span>
                    <span>enforced on-chain</span>
                  </>
                }
              />
              <Chips
                items={[
                  { label: "Spend limit", on: true },
                  { label: "Verified only", on: true },
                  { label: "Revoke" },
                ]}
              />
            </div>
          </Frame>

          <Frame corner="tr" color="sun">
            <div className="lp-pcard">
              <div className="lp-pcard-top">
                <span>Autonomous payment</span>
                <span>⚡</span>
              </div>
              <MonoRows>
                <MonoRow label="GET /v1/research" value="402" tone="bad" />
                <MonoRow label="policy check" value="✓ under budget" tone="ok" />
                <MonoRow label="PAYMENT-SIGNATURE" value="✓ signed" tone="ok" />
                <MonoRow label="settled on-chain" value="200 OK" tone="ok" />
              </MonoRows>
            </div>
          </Frame>

          <Frame corner="br" color="lime">
            <div className="lp-pcard">
              <div className="lp-pcard-top">
                <span>Bazaar</span>
                <span>◎</span>
              </div>
              <span className="lp-verified">✓ Trust-ranked</span>
              <div className="lp-rlist">
                {BAZAAR.map((r) => (
                  <div className="lp-rrow" key={r.name}>
                    <div className="ri"></div>
                    <div className="rn">
                      <b>{r.name}</b>
                      <span>{r.meta}</span>
                    </div>
                    <span className="open">Pay</span>
                  </div>
                ))}
              </div>
            </div>
          </Frame>
        </div>
      </div>
    </header>
  );
}
