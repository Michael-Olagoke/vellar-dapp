import { LpShell } from "./landing/shell";
import { Hero } from "./landing/hero";
import { X402Pillars } from "./landing/pillars";
import { TraceSection } from "./landing/trace";
import { Playground } from "./landing/playground";
import { EverydayRail } from "./landing/everyday";
import { Platforms } from "./landing/platforms";
import { ExtensionSteps } from "./landing/steps";
import { WalletServices } from "./landing/bento";
import { FaqSection } from "./landing/faq";
import { SdkCta } from "./landing/cta";

// Marketing landing — "paper & signals" system. Sections and shared
// primitives live in app/landing/ (styling in landing.css, imported by
// the shell); the wallet app at /app keeps the dark VELA system.

export default function Landing() {
  return (
    <LpShell>
      <Hero />
      <X402Pillars />
      <TraceSection />
      <Playground />
      <EverydayRail />
      <Platforms />
      <ExtensionSteps />
      <WalletServices />
      <FaqSection />
      <SdkCta />
    </LpShell>
  );
}
