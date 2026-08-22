"use client";

import { useEffect, useState } from "react";

/**
 * Scroll-spy + clean-URL hash handling shared by the marketing navs.
 *
 * Returns the id of the section currently crossing a band around the
 * upper-middle of the viewport (or null). While active it also:
 * - scrolls to a landed-on hash (e.g. /#agents from another page), then
 *   strips it so hashes never accumulate in the URL;
 * - strips any hash written by other in-page anchors (footer links etc.).
 */
export function useScrollSpy(sectionIds: readonly string[], enabled: boolean) {
  const [section, setSection] = useState<string | null>(null);
  const key = sectionIds.join(",");

  useEffect(() => {
    if (!enabled || typeof IntersectionObserver === "undefined") return;
    if (window.location.hash) {
      document.getElementById(window.location.hash.slice(1))?.scrollIntoView();
      history.replaceState(null, "", "/");
    }
    const targets = key
      .split(",")
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
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
    const onHashChange = () => {
      if (window.location.hash) history.replaceState(null, "", "/");
    };
    window.addEventListener("hashchange", onHashChange);
    return () => {
      observer.disconnect();
      window.removeEventListener("hashchange", onHashChange);
    };
  }, [enabled, key]);

  return section;
}

/** Smooth-scroll to a landing section without writing a hash into the URL. */
export function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  history.replaceState(null, "", "/");
}
