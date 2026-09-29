"use client";

import { AlertTriangleIcon, FlaskConicalIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Wordmark } from "@/components/brand/logo";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/drawer";
import { checkContractDrift, type DriftResult } from "@/lib/api/contract-drift";
import { useAuth } from "@/lib/auth/hooks";
import { env } from "@/lib/config/env";
import { useUserStream } from "@/lib/realtime/use-user-stream";
import { useUiStore } from "@/stores/ui";
import { CommandPalette } from "./command-palette";
import { NotificationsPanel } from "./notifications-panel";
import { OrgSwitcher } from "./org-switcher";
import { Sidebar, SidebarNav } from "./sidebar";
import { Topbar } from "./topbar";

function DemoBanner() {
  if (!env.demoMode) return null;
  return (
    <div role="status" className="flex items-center justify-center gap-2 border-b border-verify/30 bg-verify/10 px-4 py-1.5 text-xs text-verify">
      <FlaskConicalIcon className="size-3.5" aria-hidden />
      Demo mode — all data and task execution are simulated in your browser. Nothing is sent to a backend.
    </div>
  );
}

function ContractDriftBanner() {
  const [drift, setDrift] = useState<DriftResult | null>(null);
  useEffect(() => {
    if (!env.isDevelopment) return;
    void checkContractDrift().then(setDrift);
  }, []);
  if (drift?.status !== "drift") return null;
  return (
    <div role="alert" className="flex items-center justify-center gap-2 border-b border-danger/40 bg-danger/12 px-4 py-1.5 text-xs text-danger">
      <AlertTriangleIcon className="size-3.5" aria-hidden />
      API contract drift: the running backend differs from the generated client. Run <code className="font-mono">npm run api:generate</code>.
    </div>
  );
}

function MobileNav() {
  const open = useUiStore((s) => s.mobileNavOpen);
  const setOpen = useUiStore((s) => s.setMobileNavOpen);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="left" className="max-w-72">
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <div className="flex h-14 items-center border-b border-line px-4">
          <Wordmark />
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          <SidebarNav onNavigate={() => setOpen(false)} />
        </div>
        <div className="border-t border-line p-3">
          <OrgSwitcher />
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  useUserStream(status === "authenticated");
  return (
    <div className="flex min-h-dvh">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <DemoBanner />
        <ContractDriftBanner />
        <Topbar />
        <main id="main" className="min-w-0 flex-1 outline-none" tabIndex={-1}>
          {children}
        </main>
      </div>
      <MobileNav />
      <CommandPalette />
      <NotificationsPanel />
    </div>
  );
}
