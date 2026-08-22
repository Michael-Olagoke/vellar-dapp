import { LpButton, MonoRow, MonoRows } from "./ui";

/** Web-first + Developer SDK platform cards. */
export function Platforms() {
  return (
    <section className="lp-sec lp-sec--tight" id="platforms">
      <div className="lp-wrap">
        <div className="lp-plat" data-reveal-group>
          <div className="lp-platcard lp-platcard--paper">
            <h3>Web-first</h3>
            <p>
              Create and use your smart wallet straight from the browser, no download, no seed
              phrase. Just a passkey.
            </p>
            <div className="mini">
              <MonoRows>
                <MonoRow label="You are sending" value="166.6 XLM" />
                <MonoRow label="Fee" value="Sponsored" />
                <MonoRow label="Policy" value="✓ OK" tone="ok" />
                <MonoRow label="Signed with" value="Passkey" />
              </MonoRows>
            </div>
            <div className="lp-cta-row">
              <LpButton href="/app" variant="forest">
                Launch web app
              </LpButton>
            </div>
          </div>
          <div className="lp-platcard lp-platcard--dark">
            <h3>Developer SDK</h3>
            <p>
              Add passkey login and a Stellar smart wallet to your app in minutes, self-custodial,
              fee-sponsored, no seed phrases.
            </p>
            <div className="mini">
              <MonoRows>
                <MonoRow label="$ npm install vellar-sdk" />
                <MonoRow label="import { createVellarWallet }" />
                <MonoRow label="await vellar.create()" value="✓ passkey" tone="ok" />
                <MonoRow label="await vellar.pay()" value="✓ sent" tone="ok" />
                <MonoRow label="await vellar.x402.fetch(url)" value="✓ paid" tone="ok" />
              </MonoRows>
            </div>
            <div className="lp-cta-row">
              <LpButton href="https://docs.vellar.xyz/" variant="sun">
                Read the docs
              </LpButton>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
