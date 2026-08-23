import { Chips, Frame, LpButton, MonoRow, MonoRows, SectionHead } from "./ui";

const LABS = [
  {
    tone: "mint",
    title: "Learn the flow",
    body: "Make a real API payment and inspect every hop, the 402 challenge, the signed header, the settled 200.",
  },
  {
    tone: "coral",
    title: "Break it",
    body: "Corrupt a payment five different ways, or try to poison the Bazaar catalog, and watch the facilitator refuse every one.",
  },
  {
    tone: "lime",
    title: "The Bazaar, live",
    body: "Browse every resource the facilitator has observed, each one with a working pay button.",
  },
  {
    tone: "sun",
    title: "Quest mode",
    body: "Five levels that walk the whole protocol, from your first payment to bonds and settlement.",
  },
] as const;

/** Playground — the whole stack running live on testnet, framed around
 *  the break-it labs (refusing bad payments is the product working). */
export function Playground() {
  return (
    <section className="lp-sec" id="playground">
      <div className="lp-wrap">
        <SectionHead
          eyebrow="Playground"
          title={
            <>
              Don&apos;t take our word for it, <em>go break it.</em>
            </>
          }
          lead="The playground runs the whole Vellar stack live on Stellar testnet. Your first payment funds a real wallet for you, then every settlement, every budget check, and every refusal happens on-chain, and you can inspect all of it."
        />
        <div className="lp-play" data-reveal-group>
          <div className="lp-playgrid">
            {LABS.map((l) => (
              <div className={`lp-playcard lp-playcard--${l.tone}`} key={l.title}>
                <h4>{l.title}</h4>
                <p>{l.body}</p>
              </div>
            ))}
          </div>
          <Frame corner="br" color="coral">
            <div className="lp-pcard">
              <div className="lp-pcard-top">
                <span>Break it, live</span>
                <span>⌁</span>
              </div>
              <Chips
                items={[
                  { label: "Tamper signature", on: true },
                  { label: "Reuse nonce" },
                  { label: "Overspend" },
                ]}
              />
              <MonoRows>
                <MonoRow label="GET /v1/research" value="402" tone="bad" />
                <MonoRow label="X-PAYMENT header" value="tampered" tone="bad" />
                <MonoRow label="facilitator verify" value="✗ refused" tone="bad" />
                <MonoRow label="funds moved" value="0.00" tone="ok" />
              </MonoRows>
              <span className="lp-verified">✓ Nothing charged, that&apos;s the point</span>
            </div>
          </Frame>
        </div>
        <div className="lp-cta-row" data-reveal>
          <LpButton href="https://playground.vellar.xyz/" variant="sun">
            Open the playground →
          </LpButton>
        </div>
      </div>
    </section>
  );
}
