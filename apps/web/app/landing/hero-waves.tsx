"use client";

import { useEffect, useState } from "react";
import { GradientWaves } from "./gradient-waves";

/** Mounts the hero's gradient-wave background only when motion is allowed —
 *  under prefers-reduced-motion nothing renders, same rule as the rest of the
 *  landing's motion (see motion.tsx). Checked client-side after mount so SSR
 *  output stays a plain empty slot, no flash. */
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
      horizonColor="#3ee6ad"
      waveColor="#c8f048"
      crestColor="#ffc94a"
      speed={0.4}
      amplitude={2.8}
      waveScale={0.75}
      waveRatio={0.8}
      swell={31.5}
      turbulence={40.5}
      tilt={1.11}
      zoom={1.05}
      height={4.4}
      fogDepth={17}
      detail="medium"
      brightness={1.1}
      opacity={1}
      mouseInteraction
      parallaxStrength={0.31}
      grain
      grainIntensity={0.07}
    />
  );
}
