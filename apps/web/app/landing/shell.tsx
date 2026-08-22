import type { ReactNode } from "react";
import { LandingMotion } from "./motion";
import { LpNav } from "./lp-nav";
import { LpFooter } from "./footer";
import "./landing.css";

/** Page chrome for every .lp marketing page: scope class, motion
 *  runtime, nav and footer. Pages compose their sections inside. */
export function LpShell({ children }: { children: ReactNode }) {
  return (
    <div className="lp">
      <LandingMotion />
      <LpNav />
      {children}
      <LpFooter />
    </div>
  );
}
