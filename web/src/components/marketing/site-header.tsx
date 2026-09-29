"use client";

import { ArrowRightIcon, MenuIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { Wordmark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/drawer";
import { cn } from "@/lib/utils";

export const NAV_LINKS = [
  { href: "/product", label: "Product" },
  { href: "/security", label: "Security" },
  { href: "/pricing", label: "Pricing" },
  { href: "/docs", label: "Docs" },
] as const;

function subscribeScroll(onChange: () => void) {
  window.addEventListener("scroll", onChange, { passive: true });
  return () => window.removeEventListener("scroll", onChange);
}

function useScrolled(threshold = 8): boolean {
  return useSyncExternalStore(
    subscribeScroll,
    () => window.scrollY > threshold,
    () => false,
  );
}

export function SiteHeader() {
  const scrolled = useScrolled();
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 border-b transition-[background-color,border-color,backdrop-filter] duration-300",
        scrolled ? "border-line bg-bg/75 backdrop-blur-xl backdrop-saturate-150" : "border-transparent bg-transparent",
      )}
    >
      <div className="mx-auto flex h-16 w-full max-w-[1240px] items-center gap-8 px-5 sm:px-8">
        <Link
          href="/"
          aria-label="AgentOS home"
          className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          <Wordmark className="text-[15px]" />
        </Link>

        <nav aria-label="Primary" className="hidden lg:block">
          <ul className="flex items-center gap-1">
            {NAV_LINKS.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  aria-current={isActive(l.href) ? "page" : undefined}
                  className="rounded-md px-3 py-2 text-[13.5px] text-fg-muted transition-colors hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none aria-[current=page]:text-fg"
                >
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/login"
            className="hidden rounded-md px-3 py-2 text-[13.5px] text-fg-muted transition-colors hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none sm:inline-flex"
          >
            Sign in
          </Link>
          <Button asChild variant="primary" size="sm" className="h-9 px-3.5">
            <Link href="/signup">Start building</Link>
          </Button>
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu">
                <MenuIcon />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="max-w-xs border-line bg-surface-1 p-0">
              <div className="flex h-16 items-center border-b border-line px-5">
                <SheetTitle asChild>
                  <span>
                    <Wordmark className="text-[15px]" />
                  </span>
                </SheetTitle>
                <SheetDescription className="sr-only">Site navigation</SheetDescription>
              </div>
              <nav aria-label="Mobile" className="flex flex-col p-3">
                {NAV_LINKS.map((l) => (
                  <SheetClose asChild key={l.href}>
                    <Link
                      href={l.href}
                      aria-current={isActive(l.href) ? "page" : undefined}
                      className="flex items-center justify-between rounded-lg px-3 py-3 text-[15px] text-fg-muted transition-colors hover:bg-white/[0.04] hover:text-fg aria-[current=page]:text-fg"
                    >
                      {l.label}
                      <ArrowRightIcon className="size-4 text-fg-subtle" aria-hidden />
                    </Link>
                  </SheetClose>
                ))}
              </nav>
              <div className="mt-auto flex flex-col gap-2 border-t border-line p-5">
                <SheetClose asChild>
                  <Button asChild variant="primary" size="lg">
                    <Link href="/signup">Start building</Link>
                  </Button>
                </SheetClose>
                <SheetClose asChild>
                  <Button asChild variant="outline" size="lg">
                    <Link href="/login">Sign in</Link>
                  </Button>
                </SheetClose>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
