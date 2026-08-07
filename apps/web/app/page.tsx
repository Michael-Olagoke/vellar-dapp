import Link from "next/link";
import { LandingNav } from "./landing/nav";
import { EverydaySection } from "./landing/rail";
import { Waves } from "./landing/waves";

// Marketing landing (reference build: landing-page/VELA Landing.html; rules
// in design.md). The wallet app lives at /app.

const features = [
  {
    title: "Instant DEX swaps",
    body: "Trade Stellar assets natively without leaving your wallet — settled on-chain in seconds.",
    icon: <path d="M7 8h10M7 8l3-3M17 16H7m10 0l-3 3" />,
  },
  {
    title: "Programmable policies",
    body: "Spending limits, co-signers, time locks and allow-lists — enforced by the network, not a promise.",
    icon: <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" />,
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
  },
  {
    title: "Sponsored fees",
    body: "Vellar sponsors network fees on everyday transactions — no need to hold XLM just to get started.",
    icon: (
      <>
        <rect x="5" y="3" width="14" height="18" rx="2" />
        <path d="M9 8h6M9 12h6M9 16h4" />
      </>
    ),
  },
  {
    title: "Passkey security",
    body: "Unlock with Face ID, Touch ID or a security key. Keys live in your device's secure enclave — nothing to write down, nothing to leak.",
    icon: <path d="M9 11a4 4 0 118 0c0 3-3 4-3 4M13 20h.01M12 3a9 9 0 100 18" />,
  },
  {
    title: "Safe account cleanup",
    body: "Reclaim locked reserves from unused trustlines and stale entries in one guided sweep.",
    icon: (
      <>
        <path d="M4 7l8-4 8 4-8 4-8-4z" />
        <path d="M4 12l8 4 8-4M4 17l8 4 8-4" />
      </>
    ),
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
  },
  {
    title: "Developer SDK",
    body: "Ship passkey auth, policies and contract-verification tooling into your own Stellar app.",
    icon: <path d="M8 9l-4 3 4 3M16 9l4 3-4 3M13 6l-2 12" />,
  },
];

const faqs = [
  {
    q: "Can my AI agent spend from my wallet?",
    a: "Yes — that's what agent keys are for. Mint your agent a scoped session key with an on-chain spending limit and it can pay x402-enabled APIs autonomously, no passkey prompt needed. The budget is enforced by a policy contract inside your wallet, not by the agent's code — go over it and the chain refuses to settle. Revoke the key at any time.",
  },
  {
    q: "Is Vellar custodial?",
    a: "No. Vellar is fully self-custodial — your account and keys live on Stellar and in your device's secure enclave. We never hold your funds or your passkeys.",
  },
  {
    q: "What happens if I lose my device?",
    a: "Register multiple passkeys across devices, and use account policies to add recovery co-signers. Losing one device doesn't lock you out — that's the whole point of moving past single seed phrases.",
  },
  {
    q: "Do I need the browser extension?",
    a: "Not to get started — Vellar is web-first. The extension is there when you want one-click connections to Stellar dApps with the same passkey and policies you've already set.",
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

export default function Landing() {
  return (
    <div className="landing-root">
      <LandingNav />

      {/* HERO */}
      <header className="hero">
        <div className="aurora">
          <Waves />
          <div className="blob3"></div>
        </div>
        <div className="hero-inner wrap">
          <span className="eyebrow">
            <span className="pulse"></span> Stellar testnet · live
          </span>
          <h1>
            Give your <span className="g">agent</span> a budget,
            <br />
            not your keys.
          </h1>
          <p className="hero-sub">
            Vellar is building the agent-payments stack for Stellar on x402 — smart accounts that
            pay HTTP-402 APIs autonomously, budgets enforced on-chain, and trust-ranked discovery.
            Secured by passkeys, not seed phrases.
          </p>
          <div className="hero-cta">
            <Link href="/app" className="btn btn-signal btn-lg">
              Launch web app →
            </Link>
            <a href="https://docs.vellar.xyz/" className="btn btn-dark btn-lg">
              Build with the SDK
            </a>
          </div>
        </div>

        {/* overlapping product UI */}
        <div className="stage">
          <div className="stage-mask">
            <div className="pcard swap">
              <div className="pc-top">
                <span>← Agent key</span>
                <span className="pc-dot">◇</span>
              </div>
              <div className="field">
                <div className="lbl">AGENT</div>
                <div className="row">
                  <span className="amt" style={{ fontSize: 20 }}>
                    research-bot
                  </span>
                  <span className="token usdc">
                    <i></i>USDC ▾
                  </span>
                </div>
                <div className="sub">
                  <span>session key GDW3…K7QP</span>
                  <span>expires in 7d</span>
                </div>
              </div>
              <div className="field">
                <div className="lbl">BUDGET USED</div>
                <div className="row">
                  <span className="amt">3.20</span>
                  <span className="token usdc">
                    <i></i>/ 25 USDC
                  </span>
                </div>
                <div className="sub">
                  <span>12 payments</span>
                  <span>enforced on-chain</span>
                </div>
              </div>
              <div className="chips">
                <b className="on">Spend limit</b>
                <b className="on">Verified only</b>
                <b>Revoke</b>
              </div>
            </div>

            <div className="pcard dash">
              <div className="pc-top">
                <span className="pc-dot">⋯</span>
                <span className="pc-dot">⚡</span>
              </div>
              <div className="acct">research-bot · autonomous ▾</div>
              <div className="bal">402 → 200</div>
              <div className="miniui" style={{ marginBottom: 4 }}>
                <div className="mr">
                  <span className="mono">GET /v1/research</span>
                  <b style={{ color: "var(--negative)" }}>402</b>
                </div>
                <div className="mr">
                  <span className="mono">price</span>
                  <b>0.10 USDC</b>
                </div>
                <div className="mr">
                  <span className="mono">policy check</span>
                  <b style={{ color: "var(--signal)" }}>✓ under budget</b>
                </div>
                <div className="mr">
                  <span className="mono">PAYMENT-SIGNATURE</span>
                  <b style={{ color: "var(--signal)" }}>✓ signed</b>
                </div>
                <div className="mr">
                  <span className="mono">settled on-chain</span>
                  <b style={{ color: "var(--signal)" }}>200 OK</b>
                </div>
              </div>
            </div>

            <div className="pcard trend">
              <div className="pc-top">
                <span>Bazaar</span>
                <span className="pc-dot">◎</span>
              </div>
              <div className="promo">
                <div className="pv"></div>
                <span className="verified">✓ Trust-ranked</span>
                <div>
                  <b>Research API</b>
                  <div className="pt">0.10 USDC / CALL · VERIFIED</div>
                </div>
              </div>
              <div className="rlist">
                <div className="rrow">
                  <div className="ri"></div>
                  <div className="rn">
                    <b>Weather API</b>
                    <span>0.05 USDC · verified</span>
                  </div>
                  <span className="open">Pay</span>
                </div>
                <div className="rrow">
                  <div className="ri"></div>
                  <div className="rn">
                    <b>Translate API</b>
                    <span>0.02 USDC · verified</span>
                  </div>
                  <span className="open">Pay</span>
                </div>
                <div className="rrow">
                  <div className="ri"></div>
                  <div className="rn">
                    <b>GPU Inference</b>
                    <span>0.25 USDC · 1.2k settlements</span>
                  </div>
                  <span className="open">Pay</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* WHAT WE'RE BUILDING ON x402 */}
      <section className="sec" id="agents">
        <div className="wrap">
          <div className="sec-head" style={{ marginBottom: 36 }}>
            <div>
              <span className="eyebrow">Building on x402</span>
              <h2>The agent-payments stack for Stellar.</h2>
            </div>
            <p>
              <a href="https://x402.org">x402</a> is the open protocol that turns HTTP 402 into
              machine-payable APIs. We&apos;re building every layer of it on Stellar: the payer —
              smart accounts with scoped agent keys — the settlement rails, and trust-ranked
              discovery so agents pay the right services.
            </p>
          </div>
          <div className="ext-steps">
            <div className="ext-step">
              <span className="ext-num mono">01</span>
              <h4>Agent keys with on-chain budgets</h4>
              <p>
                One passkey tap mints your agent a scoped session key — locked to the tokens you
                choose, capped by a spending-limit policy. The budget lives in a contract, not in
                code the agent could bypass, and you can revoke the key remotely any time.
              </p>
            </div>
            <div className="ext-step">
              <span className="ext-num mono">02</span>
              <h4>Autonomous payments via the SDK</h4>
              <p>
                The first x402 client built for Stellar smart accounts. One call handles the 402
                challenge — sign headlessly, pay, get the resource. An over-budget payment fails
                on-chain before any money moves.
              </p>
            </div>
            <div className="ext-step">
              <span className="ext-num mono">03</span>
              <h4>Facilitator + trust-ranked Bazaar</h4>
              <p>
                Our open-source facilitator verifies and settles x402 payments — including
                policy-governed smart accounts other facilitators reject — and its Bazaar lets
                agents discover payable APIs ranked by real settlement data and contract
                verification.
              </p>
            </div>
          </div>
          <div className="hero-cta" style={{ marginTop: 32 }}>
            <a href="https://docs.vellar.xyz/docs/agent-keys" className="btn btn-dark">
              Read the agent-keys guide
            </a>
            <a href="https://github.com/Vellar-Wallet/vellar-facilitator" className="btn btn-dark">
              Facilitator on GitHub
            </a>
          </div>
        </div>
      </section>

      <EverydaySection />

      {/* PLATFORM CARDS */}
      <section className="sec" id="platforms" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="plat">
            <div className="platcard">
              <div className="pglow"></div>
              <h3>Web-first</h3>
              <p>
                Create and use your smart wallet straight from the browser — no download, no seed
                phrase. Just a passkey.
              </p>
              <div className="pfoot">
                <Link href="/app" className="btn btn-glass">
                  Launch web app
                </Link>
              </div>
              <div className="mini">
                <div className="miniui">
                  <div className="mr">
                    <span>You are sending</span>
                    <b>166.6 XLM</b>
                  </div>
                  <div className="mr">
                    <span>Fee</span>
                    <b>Sponsored</b>
                  </div>
                  <div className="mr">
                    <span>Policy</span>
                    <b style={{ color: "var(--signal)" }}>✓ OK</b>
                  </div>
                  <div className="mr">
                    <span>Signed with</span>
                    <b>Passkey</b>
                  </div>
                </div>
              </div>
            </div>
            <div
              className="platcard"
              style={{
                background: "linear-gradient(135deg,#0f3d33,var(--green-mid) 60%,var(--green))",
              }}
            >
              <div className="pglow" style={{ background: "var(--signal)" }}></div>
              <h3>Developer SDK</h3>
              <p>
                Add passkey login and a Stellar smart wallet to your app in minutes —
                self-custodial, fee-sponsored, no seed phrases.
              </p>
              <div className="pfoot">
                <a href="https://docs.vellar.xyz/" className="btn btn-glass">
                  Read the docs
                </a>
              </div>
              <div className="mini">
                <div className="miniui">
                  <div className="mr">
                    <span className="mono">$ npm install vellar-sdk</span>
                  </div>
                  <div className="mr">
                    <span className="mono" style={{ color: "var(--muted2)" }}>
                      import {"{"} createVellarWallet {"}"}
                    </span>
                  </div>
                  <div className="mr">
                    <span className="mono">await vellar.create()</span>
                    <b style={{ color: "var(--signal)" }}>✓ passkey</b>
                  </div>
                  <div className="mr">
                    <span className="mono">await vellar.pay()</span>
                    <b style={{ color: "var(--signal)" }}>✓ sent</b>
                  </div>
                  <div className="mr">
                    <span className="mono">await vellar.x402.fetch(url)</span>
                    <b style={{ color: "var(--signal)" }}>✓ paid</b>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* HOW THE EXTENSION WORKS */}
      <section className="sec" id="extension">
        <div className="wrap">
          <div className="sec-head" style={{ marginBottom: 36 }}>
            <div>
              <span className="eyebrow">Browser extension</span>
              <h2>Connect to any Stellar dApp.</h2>
            </div>
            <p>
              The Vellar extension pairs with your wallet once, then approves dApp connections and
              signing — with the same passkey and on-chain policies you already set. No seed phrase
              ever enters the browser.
            </p>
          </div>
          <div className="ext-steps">
            <div className="ext-step">
              <span className="ext-num mono">01</span>
              <h4>Pair once</h4>
              <p>
                Approve the extension from your wallet with a single passkey tap. It gets a secure
                device key — bound to your account, and it expires automatically.
              </p>
            </div>
            <div className="ext-step">
              <span className="ext-num mono">02</span>
              <h4>Connect to dApps</h4>
              <p>
                When a Stellar app requests access, the extension shows exactly which site is
                asking. You approve per-origin — nothing connects silently.
              </p>
            </div>
            <div className="ext-step">
              <span className="ext-num mono">03</span>
              <h4>Review &amp; sign</h4>
              <p>
                Every transaction is decoded and shown before you approve. Your spending limits and
                policies are enforced on-chain — the extension can&apos;t bypass them.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* FEATURE GRID */}
      <section className="sec" id="features">
        <div className="wrap">
          <div className="sec-head" style={{ marginBottom: 36 }}>
            <div>
              <span className="eyebrow">Wallet services</span>
              <h2>Everything a smart wallet should do.</h2>
            </div>
            <p>
              Agents are only half the story. Vellar is a full self-custodial smart wallet for
              people too — passkeys, programmable policies and trust signals layered over your
              Stellar account. No custody, no compromises.
            </p>
          </div>
          <div className="fgrid">
            {features.map((f) => (
              <div className="fcell" key={f.title}>
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
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="sec" id="faq">
        <div className="wrap faq-grid">
          <div>
            <span className="eyebrow" style={{ display: "block", marginBottom: 16 }}>
              Questions
            </span>
            <h2>Frequently asked questions</h2>
            <p style={{ color: "var(--muted)", marginTop: 16, fontSize: 15, lineHeight: 1.6 }}>
              Still curious? Reach us at <a href="mailto:hello@vellar.xyz">hello@vellar.xyz</a> or
              read the <a href="https://docs.vellar.xyz/">developer docs</a>.
            </p>
          </div>
          <div>
            {faqs.map((f) => (
              <details className="fitem" key={f.q}>
                <summary>
                  {f.q} <span className="pm">+</span>
                </summary>
                <div className="fbody">{f.a}</div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="wrap" id="cta">
        <div className="cta">
          <div className="g1"></div>
          <div className="g2"></div>
          <h2 className="cta-try">
            <span>Try out the</span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-light.png" alt="Vellar" className="cta-try-logo" />
            <span>SDK</span>
          </h2>
          <p>
            Add passkey login, a Stellar smart wallet and x402 agent payments to your app in
            minutes — self-custodial, fee-sponsored, no seed phrases.
          </p>
          <div className="hero-cta">
            <a href="https://docs.vellar.xyz/" className="btn btn-glass btn-lg">
              Read the docs
            </a>
            <a href="https://github.com/Vellar-Wallet/vellar-sdk" className="btn btn-glass btn-lg">
              View on GitHub
            </a>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="site">
        <div className="wrap">
          <div className="foot-top">
            <div className="foot-brand">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo-light.png" alt="Vellar" />
              <p>
                The agent-payments stack for Stellar, built on x402 — passkey smart wallets,
                programmable policies and trust signals, for people and their agents.
              </p>
            </div>
            <div className="foot-cols">
              <div className="foot-col">
                <h4>Product</h4>
                <Link href="/app">Wallet</Link>
                <a href="#extension">Extension</a>
                <a href="#agents">Agent payments</a>
                <a href="#faq">FAQ</a>
              </div>
              <div className="foot-col">
                <h4>Developers</h4>
                <a href="https://docs.vellar.xyz/">Documentation</a>
                <a href="https://docs.vellar.xyz/docs/quickstart">Quickstart</a>
                <a href="https://docs.vellar.xyz/docs/api-reference">SDK reference</a>
                <a href="https://github.com/Vellar-Wallet/vellar-sdk">GitHub</a>
              </div>
              <div className="foot-col">
                <h4>Company</h4>
                <Link href="/about">About</Link>
                <a href="https://docs.vellar.xyz/docs/security">Security</a>
                <a href="mailto:hello@vellar.xyz">Contact</a>
              </div>
            </div>
          </div>
          <div className="foot-bot">
            <span>© 2026 Vellar · Built on Stellar</span>
            <span className="mono">passkeys · policies · trust · agents</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
