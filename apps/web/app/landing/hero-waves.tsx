"use client";

import { useEffect, useState } from "react";
import { GradientWaves } from "./gradient-waves";

/** Mounts the hero's ambient gradient only when motion is allowed — under
 *  prefers-reduced-motion nothing renders, same rule as the rest of the
 *  landing's motion (see motion.tsx). Checked client-side after mount so
 *  SSR output stays a plain empty hero background, no flash. */
export function HeroWaves() {
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    setAllowed(!window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  if (!allowed) return null;

  return (
    <GradientWaves
      className="lp-hero-waves"
      horizonColor="#ffffff"
      waveColor="#3ee6ad"
      crestColor="#c8f048"
      speed={0.24}
      amplitude={2.8}
      waveScale={0.6}
      waveRatio={0.85}
      swell={26}
      turbulence={16}
      tilt={0.62}
      zoom={0.68}
      height={2.6}
      fogDepth={19}
      detail="medium"
      brightness={1.2}
      opacity={0.9}
      mouseInteraction={true}
      parallaxStrength={0.2}
      grain={false}
    />
  );
}
