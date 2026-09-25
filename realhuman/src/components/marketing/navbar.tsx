"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MobileNav } from "@/components/marketing/mobile-nav";
import { Button, ButtonArrow } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { Logo } from "@/components/ui/logo";
import { useScrollSpy } from "@/hooks/use-scroll-spy";
import { useScrolled } from "@/hooks/use-scrolled";
import { primaryNav, routes, siteConfig } from "@/lib/constants/site";
import { cn } from "@/lib/utils/cn";

const SECTION_IDS = primaryNav.flatMap((item) => (item.sectionId ? [item.sectionId] : []));

export function Navbar() {
  const pathname = usePathname();
  const onHome = pathname === "/";
  const scrolled = useScrolled(12);
  const activeSection = useScrollSpy(SECTION_IDS, onHome);

  const isActive = (href: string, sectionId?: string) =>
    sectionId ? onHome && activeSection === sectionId : pathname.startsWith(href);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-(--z-nav) border-b transition-[background-color,border-color,backdrop-filter] duration-300",
        scrolled
          ? "border-border bg-background/72 backdrop-blur-xl backdrop-saturate-150"
          : "border-transparent bg-transparent",
      )}
    >
      <Container size="wide" className="flex h-(--nav-height) items-center gap-4">
        <Link
          href="/"
          className="-ml-1 rounded-md px-1 py-1"
          aria-label={`${siteConfig.name} home`}
        >
          <Logo />
        </Link>

        <nav aria-label="Primary" className="ml-6 hidden md:block">
          <ul className="flex items-center gap-0.5">
            {primaryNav.map((item) => {
              const active = isActive(item.href, item.sectionId);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? (item.sectionId ? "location" : "page") : undefined}
                    className={cn(
                      "relative inline-flex h-9 items-center rounded-md px-3 text-sm transition-colors duration-150",
                      active ? "text-foreground" : "text-muted hover:text-foreground",
                    )}
                  >
                    {item.label}
                    <span
                      aria-hidden
                      className={cn(
                        "absolute inset-x-3 -bottom-[13px] h-px bg-foreground/80 transition-opacity duration-300",
                        active ? "opacity-100" : "opacity-0",
                      )}
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="ml-auto hidden items-center gap-2 md:flex">
          <Button asChild variant="ghost" size="sm">
            <Link href={routes.login}>Log in</Link>
          </Button>
          <Button asChild size="sm">
            <Link href={routes.signup}>
              Get API Key
              <ButtonArrow />
            </Link>
          </Button>
        </div>

        <MobileNav className="ml-auto md:hidden" isActive={isActive} />
      </Container>
    </header>
  );
}
