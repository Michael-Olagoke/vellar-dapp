import { Eyebrow } from "./ui";

const ROWS = [
  { label: "GET /v1/research", value: "402", tone: "bad" },
  { label: "price", value: "0.10 USDC" },
  { label: "policy check", value: "✓ under budget", tone: "ok" },
  { label: "PAYMENT-SIGNATURE", value: "✓ signed", tone: "ok" },
  { label: "settled on-chain", value: "200 OK", tone: "ok" },
] as const;

/** The pinned 402 → 200 moment: motion.tsx scrubs the rows and the
 *  progress bar via the data-trace* hooks while the section is pinned. */
export function TraceSection() {
  return (
    <section className="lp-trace lp-invert" data-trace>
      <div className="lp-wrap lp-trace-pin" data-trace-pin>
        <div className="lp-trace-grid">
          <div>
            <Eyebrow>One request, end to end</Eyebrow>
            <h2 className="mt-[var(--lp-sp-4)]!">
              Your agent hits a paywall. <em>It pays it.</em>
            </h2>
            <p className="lp-lead">
              One call handles the whole challenge: parse the 402, check the on-chain budget, sign
              headlessly, retry, settle on Stellar. Over budget? The chain refuses before any money
              moves.
            </p>
          </div>
          <div className="lp-trace-panel">
            <div className="head">
              <span>research-bot · autonomous</span>
              <span>402 → 200</span>
            </div>
            {ROWS.map((r) => (
              <div className="lp-trace-row" data-trace-row key={r.label}>
                <span>{r.label}</span>
                <b className={"tone" in r ? r.tone : undefined}>{r.value}</b>
              </div>
            ))}
            <div className="lp-trace-bar">
              <i data-trace-bar />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
