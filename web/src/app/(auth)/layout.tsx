import type { Metadata } from "next";
import Link from "next/link";
import { Wordmark } from "@/components/brand/logo";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Sign-in surfaces: quiet, focused, with the lifecycle as the only ornament. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative grid min-h-dvh lg:grid-cols-[1fr_minmax(0,34rem)]">
      <aside className="relative hidden overflow-hidden border-r border-line bg-surface-1 lg:block" aria-hidden>
        <div className="absolute inset-0 bg-grid [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)] opacity-60" />
        <div className="absolute top-1/2 left-1/2 size-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/10 blur-[120px]" />
        <div className="relative flex h-full flex-col justify-between p-10">
          <Wordmark />
          <div className="max-w-md">
            <p className="text-display-sm font-semibold text-fg">
              Give AI a goal.
              <br />
              <span className="text-fg-muted">AgentOS gets the work done.</span>
            </p>
            <ol className="mt-8 flex flex-wrap gap-2 font-mono text-2xs tracking-[0.18em] text-fg-subtle uppercase">
              {["Goal", "Plan", "Validate", "Approve", "Execute", "Verify", "Recover", "Learn"].map((s, i) => (
                <li key={s} className="flex items-center gap-2">
                  <span className={i === 5 ? "text-verify" : i === 4 ? "text-accent" : undefined}>{s}</span>
                  {i < 7 && <span className="text-line-strong">→</span>}
                </li>
              ))}
            </ol>
          </div>
          <p className="text-xs text-fg-subtle">
            Every action is policy-checked, approved when it matters, verified and audited.
          </p>
        </div>
      </aside>
      <main id="main" className="flex flex-col px-5 py-8 sm:px-10">
        <div className="lg:hidden">
          <Link href="/" aria-label="AgentOS home">
            <Wordmark />
          </Link>
        </div>
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-sm">{children}</div>
        </div>
      </main>
    </div>
  );
}
