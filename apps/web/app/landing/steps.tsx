import { SectionHead } from "./ui";

const STEPS = [
  {
    num: "01",
    title: "Pair once",
    body: "Approve the extension from your wallet with a single passkey tap. It gets a secure device key, bound to your account, and it expires automatically.",
  },
  {
    num: "02",
    title: "Connect to dApps",
    body: "When a Stellar app requests access, the extension shows exactly which site is asking. You approve per-origin, nothing connects silently.",
  },
  {
    num: "03",
    title: "Review & sign",
    body: "Every transaction is decoded and shown before you approve. Your spending limits and policies are enforced on-chain, so the extension can't bypass them.",
  },
];

/** "How the extension works" — three accent-bordered step cards. */
export function ExtensionSteps() {
  return (
    <section className="lp-sec" id="extension">
      <div className="lp-wrap">
        <SectionHead
          eyebrow="Browser extension"
          title={
            <>
              Connect to <em>any</em> Stellar dApp.
            </>
          }
          lead="The Vellar extension pairs with your wallet once, then approves dApp connections and signing, with the same passkey and on-chain policies you already set. No seed phrase ever enters the browser."
        />
        <div className="lp-steps" data-reveal-group>
          {STEPS.map((s) => (
            <div className="lp-step" key={s.num}>
              <span className="num">{s.num}</span>
              <h4>{s.title}</h4>
              <p>{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
