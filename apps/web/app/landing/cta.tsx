import { LpButton } from "./ui";

/** The inverted "ship it" band that closes every marketing page. */
export function SdkCta() {
  return (
    <section className="lp-cta lp-invert" id="cta">
      <div className="lp-wrap" data-reveal>
        <h2>
          Ship agent payments <em>today.</em>
        </h2>
        <p>
          Add passkey login, a Stellar smart wallet and x402 agent payments to your app in minutes,
          self-custodial, fee-sponsored, no seed phrases.
        </p>
        <div className="lp-cta-row">
          <LpButton href="https://docs.vellar.xyz/" variant="sun" size="lg">
            Read the docs
          </LpButton>
          <LpButton href="https://github.com/Vellar-Wallet/vellar-sdk" variant="ghost" size="lg">
            View on GitHub
          </LpButton>
        </div>
      </div>
    </section>
  );
}
