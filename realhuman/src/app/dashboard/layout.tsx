import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Sidebar } from "@/components/dashboard/sidebar";
import { Topbar } from "@/components/dashboard/topbar";

export const metadata: Metadata = {
  title: { default: "Dashboard", template: "%s · Dashboard" },
  robots: { index: false, follow: false },
};

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main id="main" tabIndex={-1} className="flex-1 px-4 py-8 outline-none sm:px-6 lg:px-10">
          <div className="mx-auto flex w-full max-w-wide flex-col gap-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
