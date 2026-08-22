"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

/** Autoplay dwell per slat — must match the CSS lp-slat-progress duration. */
const DWELL_MS = 4600;

type Item = {
  name: string;
  desc: string;
  accent: string;
  soft: string;
  mock: ReactNode;
};

/* Mock markup is spans only — it lives inside a <button>, which allows
   phrasing content exclusively. The classes carry the layout. */
const ITEMS: Item[] = [
  {
    name: "Send",
    desc: "Payments to any Stellar address, decoded, policy-checked and passkey-signed before anything moves.",
    accent: "var(--lp-mint)",
    soft: "var(--lp-mint-soft)",
    mock: (
      <>
        <span className="lp-field">
          <span className="lbl">YOU ARE SENDING</span>
          <span className="row">
            <span className="amt" style={{ fontSize: 18 }}>
              166.6
            </span>
            <span className="lp-token">
              <i></i>XLM
            </span>
          </span>
          <span className="sub">
            <span>to GB4X…9F2A</span>
            <span>fee sponsored</span>
          </span>
        </span>
        <span className="lp-badge">✓ Sent</span>
      </>
    ),
  },
  {
    name: "Swap",
    desc: "Trade Stellar assets natively without leaving your wallet, settled on-chain in seconds.",
    accent: "var(--lp-sun)",
    soft: "var(--lp-sun-soft)",
    mock: (
      <>
        <span className="lp-field">
          <span className="lbl">YOU SELL</span>
          <span className="row">
            <span className="amt" style={{ fontSize: 18 }}>
              100
            </span>
            <span className="lp-token">
              <i></i>XLM
            </span>
          </span>
        </span>
        <span className="lp-field">
          <span className="lbl">YOU RECEIVE</span>
          <span className="row">
            <span className="amt" style={{ fontSize: 18 }}>
              18.98
            </span>
            <span className="lp-token lp-token--usdc">
              <i></i>USDC
            </span>
          </span>
        </span>
      </>
    ),
  },
  {
    name: "Deposit",
    desc: "Fund from an exchange or another wallet, sponsored fees mean you don't need XLM to get started.",
    accent: "var(--lp-lime)",
    soft: "var(--lp-lime-soft)",
    mock: (
      <>
        <span className="lp-field">
          <span className="lbl">DEPOSIT ADDRESS</span>
          <span className="row">
            <span className="amt" style={{ fontSize: 18 }}>
              GDW3…K7QP
            </span>
            <span className="lp-token">
              <i></i>XLM
            </span>
          </span>
          <span className="sub">
            <span>tap to copy</span>
            <span>no minimum</span>
          </span>
        </span>
        <span className="lp-badge">✓ Deposited</span>
      </>
    ),
  },
  {
    name: "Discover",
    desc: "Every asset you hold in one place, with trust signals before you add a new trustline.",
    accent: "var(--lp-ink)",
    soft: "var(--lp-paper-tint)",
    mock: (
      <span className="lp-rlist">
        <span className="lp-rrow">
          <span className="ri"></span>
          <span className="rn">
            <b>Stellar Lumens</b>
            <span>XLM</span>
          </span>
        </span>
        <span className="lp-rrow">
          <span className="ri"></span>
          <span className="rn">
            <b>USD Coin</b>
            <span>USDC</span>
          </span>
        </span>
        <span className="lp-rrow">
          <span className="ri"></span>
          <span className="rn">
            <b>yXLM</b>
            <span>Yield</span>
          </span>
        </span>
      </span>
    ),
  },
  {
    name: "Set policies",
    desc: "Spending limits, co-signers and time locks, enforced by the network, not a promise.",
    accent: "var(--lp-coral)",
    soft: "var(--lp-coral-soft)",
    mock: (
      <>
        <span className="lp-chips">
          <b className="on">Spend limit</b>
          <b className="on">Verified only</b>
          <b>Revoke</b>
        </span>
        <span className="lp-badge">Passkey</span>
      </>
    ),
  },
];

/**
 * "Everyday wallet" spread accordion: one row of narrow vertical slats,
 * exactly one expanded at a time. flex-grow is the ONLY animated
 * dimension; the asymmetric crossfade and autoplay behavior follow the
 * section spec exactly. Below 900px the CSS renders a plain stacked
 * list and autoplay never runs.
 */
export function EverydayRail() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [inView, setInView] = useState(false);
  // Rail mode = viewport ≥901px. Autoplay additionally needs no
  // reduced-motion preference. Both default false (SSR, jsdom).
  const [isRail, setIsRail] = useState(false);
  const [reduced, setReduced] = useState(true);
  const railRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return; // no autoplay where unknowable
    const railQuery = window.matchMedia("(min-width: 901px)");
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      setIsRail(railQuery.matches);
      setReduced(motionQuery.matches);
    };
    update();
    railQuery.addEventListener("change", update);
    motionQuery.addEventListener("change", update);
    return () => {
      railQuery.removeEventListener("change", update);
      motionQuery.removeEventListener("change", update);
    };
  }, []);

  // Autoplay only while the rail is actually on screen.
  useEffect(() => {
    const el = railRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setInView(entry?.isIntersecting ?? false), {
      threshold: 0.25,
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const playing = isRail && !reduced && inView && !paused;

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setActive((i) => (i + 1) % ITEMS.length), DWELL_MS);
    return () => clearInterval(id);
  }, [playing]);

  /** pointerenter, focus and click all behave identically: jump + pause. */
  const goTo = (i: number) => {
    setActive(i);
    setPaused(true);
  };

  return (
    <section className="lp-sec" id="wallet">
      <div className="lp-wrap">
        <div className="lp-sechead" data-reveal>
          <div>
            <span className="lp-eyebrow">Everyday actions</span>
            <h2>
              Your everyday <em>Stellar</em> wallet.
            </h2>
          </div>
        </div>
        <div
          className="lp-spread"
          ref={railRef}
          onPointerLeave={() => setPaused(false)}
          data-reveal
        >
          {ITEMS.map((item, i) => {
            const expanded = i === active;
            return (
              <button
                key={item.name}
                type="button"
                className="lp-slat"
                aria-expanded={expanded}
                style={{ "--slat-accent": item.accent, "--slat-soft": item.soft } as CSSProperties}
                onClick={() => goTo(i)}
                onPointerEnter={() => goTo(i)}
                onFocus={() => goTo(i)}
              >
                <span className="lp-slat-face" aria-hidden={isRail ? expanded : true}>
                  <span className="num">{String(i + 1).padStart(2, "0")}</span>
                  <span className="name">{item.name}</span>
                  <span className="dot" />
                </span>
                <span className="lp-slat-body" aria-hidden={isRail ? !expanded : false}>
                  <span className="title">{item.name}</span>
                  <span className="desc">{item.desc}</span>
                  <span className="lp-slat-mock">{item.mock}</span>
                </span>
                {playing && expanded ? (
                  <span key={active} className="lp-slat-progress" aria-hidden />
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
