"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { scrollToSection, useScrollSpy } from "./use-scroll-spy";

/** Landing sections the nav tracks for scroll-spy highlighting. */
const SECTIONS = [
  { id: "agents", label: "x402" },
  { id: "wallet", label: "Wallet" },
  { id: "faq", label: "FAQ" },
] as const;

const SECTION_IDS = SECTIONS.map((s) => s.id);

/** Sticky paper nav for all .lp marketing pages. */
export function LpNav() {
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState("");
  const close = () => setOpen(false);
  const onLanding = path === "/";
  const section = useScrollSpy(SECTION_IDS, onLanding);

  useEffect(() => {
    setPath(window.location.pathname);
  }, []);

  const goTo = (id: string) => (e: React.MouseEvent) => {
    close();
    if (!onLanding) return;
    e.preventDefault();
    scrollToSection(id);
  };

  return (
    <div className="lp-nav-outer">
      <nav className="lp-nav">
        <Link href="/" className="lp-brand" onClick={close}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mark.png" alt="Vellar" />
        </Link>
        <div className={`lp-nav-links${open ? " open" : ""}`}>
          {SECTIONS.map((s) => (
            <Link
              key={s.id}
              href={`/#${s.id}`}
              className={onLanding && section === s.id ? "active" : ""}
              onClick={goTo(s.id)}
            >
              {s.label}
            </Link>
          ))}
          <Link href="/about" onClick={close}>
            About
          </Link>
          <a href="https://docs.vellar.xyz/" onClick={close}>
            Docs
          </a>
          <a href="https://explorer.vellar.xyz/" onClick={close}>
            Explorer
          </a>
        </div>
        <Link href="/app" className="lp-btn lp-btn--forest">
          Launch app
        </Link>
        <button
          className="lp-nav-toggle"
          onClick={() => setOpen(!open)}
          aria-label="Menu"
          aria-expanded={open}
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 22 22"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            {open ? <path d="M4 4l14 14M18 4L4 18" /> : <path d="M3 6h16M3 11h16M3 16h16" />}
          </svg>
        </button>
      </nav>
    </div>
  );
}
