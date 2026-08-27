"use client";

import { useEffect } from "react";

/**
 * Landing motion: Lenis smooth scroll + GSAP/ScrollTrigger reveals, hero
 * word masks, gentle parallax, and the one pinned scrubbed moment (the
 * 402 → 200 trace). Everything is:
 * - dynamically imported (never in the SSR bundle, never loaded in jsdom
 *   tests — the matchMedia guard bails first);
 * - fully disabled under prefers-reduced-motion (no Lenis, no tweens; the
 *   page's static state is complete and legible on its own);
 * - reverted on unmount so client-side navigation stays clean.
 *
 * Motion character: two easings only — "expo.out" for every reveal (one
 * consistent arrival), "none" for scrubbed/parallax movement.
 */
export function LandingMotion() {
  useEffect(() => {
    // jsdom (unit tests) has no matchMedia; treat unknown as no-motion.
    if (typeof window.matchMedia !== "function") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let cancelled = false;
    let cleanup: (() => void) | undefined;

    (async () => {
      const [gsapMod, stMod, lenisMod] = await Promise.all([
        import("gsap"),
        import("gsap/ScrollTrigger"),
        import("lenis"),
      ]);
      if (cancelled) return;
      const gsap = gsapMod.gsap;
      const ScrollTrigger = stMod.ScrollTrigger;
      const Lenis = lenisMod.default;
      gsap.registerPlugin(ScrollTrigger);

      const root = document.querySelector<HTMLElement>(".lp");
      if (!root) return;

      const lenis = new Lenis({ duration: 1.05 });
      lenis.on("scroll", ScrollTrigger.update);
      const raf = (time: number) => lenis.raf(time * 1000);
      gsap.ticker.add(raf);
      gsap.ticker.lagSmoothing(0);

      const mm = gsap.matchMedia();
      const ctx = gsap.context(() => {
        // Hero statement: mask-reveal each word (em phrase splits too, so the
        // italic words rise like the rest). Idempotent across strict-mode
        // re-runs via the data flag.
        const heroH1 = root.querySelector<HTMLElement>("[data-split]");
        if (heroH1) {
          if (!heroH1.hasAttribute("data-split-done")) {
            splitWords(heroH1);
            heroH1.setAttribute("data-split-done", "");
          }
          gsap.from(heroH1.querySelectorAll(".lp-w-i"), {
            yPercent: 112,
            duration: 0.9,
            ease: "expo.out",
            stagger: 0.055,
            delay: 0.1,
          });
        }

        // Everything above the fold that isn't the h1 fades up on load.
        const heroIntro = root.querySelectorAll("[data-hero-fade]");
        if (heroIntro.length) {
          gsap.from(heroIntro, {
            y: 24,
            autoAlpha: 0,
            duration: 0.8,
            ease: "expo.out",
            stagger: 0.1,
            delay: 0.35,
          });
        }

        // Scroll reveals: single elements…
        gsap.utils.toArray<HTMLElement>("[data-reveal]").forEach((el) => {
          gsap.from(el, {
            y: 28,
            autoAlpha: 0,
            duration: 0.75,
            ease: "expo.out",
            scrollTrigger: { trigger: el, start: "top 85%", once: true },
          });
        });
        // …and groups whose direct children stagger in together.
        gsap.utils.toArray<HTMLElement>("[data-reveal-group]").forEach((group) => {
          gsap.from(group.children, {
            y: 28,
            autoAlpha: 0,
            duration: 0.75,
            ease: "expo.out",
            stagger: 0.09,
            scrollTrigger: { trigger: group, start: "top 85%", once: true },
          });
        });

        // The pinned moment: scrub through the 402 → 200 request trace.
        const traceSec = root.querySelector<HTMLElement>("[data-trace]");
        const tracePin = traceSec?.querySelector<HTMLElement>("[data-trace-pin]");
        if (traceSec && tracePin) {
          const rows = traceSec.querySelectorAll<HTMLElement>("[data-trace-row]");
          const bar = traceSec.querySelector<HTMLElement>("[data-trace-bar]");
          mm.add("(min-width: 801px)", () => {
            gsap.set(rows, { autoAlpha: 0.22, x: -10 });
            if (bar) gsap.set(bar, { scaleX: 0, transformOrigin: "left center" });
            const tl = gsap.timeline({
              scrollTrigger: {
                trigger: traceSec,
                start: "top top",
                end: "+=160%",
                pin: tracePin,
                scrub: 0.4,
              },
            });
            rows.forEach((row) => {
              tl.to(row, { autoAlpha: 1, x: 0, duration: 1, ease: "none" });
            });
            if (bar) tl.to(bar, { scaleX: 1, duration: rows.length, ease: "none" }, 0);
          });
          mm.add("(max-width: 800px)", () => {
            // No pinning on small screens — a plain staggered reveal instead.
            gsap.from(rows, {
              autoAlpha: 0,
              x: -10,
              duration: 0.5,
              ease: "expo.out",
              stagger: 0.12,
              scrollTrigger: { trigger: traceSec, start: "top 70%", once: true },
            });
          });
        }
      }, root);

      cleanup = () => {
        mm.revert();
        ctx.revert();
        gsap.ticker.remove(raf);
        lenis.destroy();
      };
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  return null;
}

/** Wrap each word (including words inside inline elements like <em>) in a
 *  clipped mask span pair so it can rise into view. textContent — and with
 *  it SSR markup, a11y and tests — is unchanged. */
function splitWords(el: Element) {
  const process = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? "";
      if (!text.trim()) return;
      const frag = document.createDocumentFragment();
      for (const part of text.split(/(\s+)/)) {
        if (!part) continue;
        if (/^\s+$/.test(part)) {
          frag.appendChild(document.createTextNode(part));
        } else {
          const outer = document.createElement("span");
          outer.className = "lp-w";
          const inner = document.createElement("span");
          inner.className = "lp-w-i";
          inner.textContent = part;
          outer.appendChild(inner);
          frag.appendChild(outer);
        }
      }
      node.parentNode?.replaceChild(frag, node);
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      [...node.childNodes].forEach(process);
    }
  };
  [...el.childNodes].forEach(process);
}
