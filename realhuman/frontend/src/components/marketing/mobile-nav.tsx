"use client";

import { Menu } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button, ButtonArrow } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { primaryNav, routes } from "@/lib/constants/site";
import { cn } from "@/lib/utils/cn";

interface MobileNavProps {
  className?: string;
  isActive: (href: string, sectionId?: string) => boolean;
}

/**
 * Mobile navigation drawer. Radix Dialog provides the focus trap, Escape to
 * close, body scroll lock and focus return to the trigger.
 */
export function MobileNav({ className, isActive }: MobileNavProps) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("-mr-2", className)}
          aria-label="Open menu"
        >
          <Menu aria-hidden />
        </Button>
      </SheetTrigger>
      <SheetContent aria-describedby={undefined}>
        <SheetTitle className="sr-only">Menu</SheetTitle>
        <div className="flex h-(--nav-height) items-center border-b border-border px-5">
          <Link href="/" onClick={close} className="rounded-md">
            <Logo />
          </Link>
        </div>
        <nav aria-label="Mobile" className="flex-1 overflow-y-auto px-3 py-4">
          <ul className="flex flex-col">
            {primaryNav.map((item) => {
              const active = isActive(item.href, item.sectionId);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={close}
                    aria-current={active ? (item.sectionId ? "location" : "page") : undefined}
                    className={cn(
                      "flex h-12 items-center rounded-lg px-3 text-lg font-medium tracking-tight transition-colors",
                      active
                        ? "bg-surface-raised text-foreground"
                        : "text-muted hover:text-foreground",
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="flex flex-col gap-2 border-t border-border p-5">
          <Button asChild size="lg">
            <Link href={routes.signup} onClick={close}>
              Get API Key
              <ButtonArrow />
            </Link>
          </Button>
          <Button asChild variant="secondary" size="lg">
            <Link href={routes.login} onClick={close}>
              Log in
            </Link>
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
