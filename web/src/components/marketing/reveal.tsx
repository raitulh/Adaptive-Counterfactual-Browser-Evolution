"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";

/**
 * Progressive reveal for `[data-reveal]` elements below the fold: a short fade-up (700 ms) as they
 * enter the viewport. Content is server-rendered visible; only JS hides what is still offscreen,
 * so nothing is ever invisible without JavaScript. Skipped entirely with reduced motion. Uses
 * opacity/transform only (no layout shift).
 */
export function RevealOnScroll() {
  const pathname = usePathname();

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const show = (el: HTMLElement, delay = 0) => {
      el.style.transitionDelay = `${delay}ms`;
      el.style.opacity = "1";
      el.style.transform = "none";
      el.dataset.revealed = "true";
    };

    const io = new IntersectionObserver(
      (entries) => {
        let i = 0;
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const el = entry.target as HTMLElement;
          io.unobserve(el);
          show(el, Math.min(i, 5) * 70);
          i += 1;
        }
      },
      { rootMargin: "0px 0px -6% 0px" },
    );

    const vh = window.innerHeight;
    document.querySelectorAll<HTMLElement>("[data-reveal]:not([data-revealed])").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.top < vh && r.bottom > 0) {
        el.dataset.revealed = "true";
        return;
      }
      el.style.opacity = "0";
      el.style.transform = "translateY(16px)";
      el.style.transition = `opacity 700ms ${EASE}, transform 700ms ${EASE}`;
      io.observe(el);
    });

    return () => io.disconnect();
  }, [pathname]);

  return null;
}
