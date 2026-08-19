"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/** Landing sections the nav tracks for scroll-spy highlighting. */
const SECTIONS = [
  { id: "agents", label: "x402" },
  { id: "faq", label: "FAQ" },
];

export function LandingNav() {
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState("");
  const [section, setSection] = useState<string | null>(null);
  const close = () => setOpen(false);
  const onLanding = path === "/";

  useEffect(() => {
    setPath(window.location.pathname);
  }, []);

  // Scroll-spy: highlight the nav link for the section in view, and keep the
  // URL clean — a landed-on hash (e.g. /#agents from another page) scrolls to
  // its section, then is stripped so hashes never accumulate in the URL.
  useEffect(() => {
    if (!onLanding || typeof IntersectionObserver === "undefined") return;
    if (window.location.hash) {
      document.getElementById(window.location.hash.slice(1))?.scrollIntoView();
      history.replaceState(null, "", "/");
    }
    const targets = SECTIONS.map((s) => document.getElementById(s.id)).filter(
      (el): el is HTMLElement => el !== null,
    );
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setSection(entry.target.id);
          } else {
            setSection((prev) => (prev === entry.target.id ? null : prev));
          }
        }
      },
      // A horizontal band around the upper-middle of the viewport: a section is
      // "active" while it crosses it.
      { rootMargin: "-35% 0px -55% 0px" },
    );
    targets.forEach((el) => observer.observe(el));
    // Any other in-page anchor (footer links etc.): let the browser scroll,
    // then strip the hash so the URL stays clean.
    const onHashChange = () => {
      if (window.location.hash) history.replaceState(null, "", "/");
    };
    window.addEventListener("hashchange", onHashChange);
    return () => {
      observer.disconnect();
      window.removeEventListener("hashchange", onHashChange);
    };
  }, [onLanding]);

  /** Smooth-scroll to a section on the landing page without writing a hash
   *  into the URL; from any other page, fall through to normal navigation. */
  const goTo = (id: string) => (e: React.MouseEvent) => {
    close();
    if (!onLanding) return;
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
    history.replaceState(null, "", "/");
  };

  return (
    <div className="nav-outer">
      <nav className="nav">
        <Link href="/" className="brand" onClick={close}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-light.png" alt="Vellar" />
        </Link>
        <div className={`nav-links${open ? " open" : ""}`}>
          <Link href="/about" className={path.startsWith("/about") ? "active" : ""} onClick={close}>
            About
          </Link>
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
          <a href="https://docs.vellar.xyz/" onClick={close}>
            Docs
          </a>
          <a href="https://explorer.vellar.xyz/" onClick={close}>
            Explorer
          </a>
        </div>
        <Link href="/app" className="btn btn-signal">
          Launch app
        </Link>
        <button className="nav-toggle" onClick={() => setOpen(!open)} aria-label="Menu">
          ☰
        </button>
      </nav>
    </div>
  );
}
