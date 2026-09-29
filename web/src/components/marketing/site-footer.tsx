import Link from "next/link";
import { Wordmark } from "@/components/brand/logo";
import { Container } from "./primitives";

const COLUMNS = [
  {
    title: "System",
    links: [
      { href: "/product", label: "Product" },
      { href: "/product#lifecycle", label: "Execution lifecycle" },
      { href: "/product#memory", label: "Memory" },
      { href: "/product#automations", label: "Automations" },
    ],
  },
  {
    title: "Trust",
    links: [
      { href: "/security", label: "Security architecture" },
      { href: "/security#approvals", label: "Approvals & policy" },
      { href: "/security#verification", label: "Verification" },
      { href: "/security#data", label: "Data handling" },
    ],
  },
  {
    title: "Build",
    links: [
      { href: "/docs", label: "Documentation" },
      { href: "/docs#quickstart", label: "API quickstart" },
      { href: "/pricing", label: "Pricing" },
      { href: "/signup", label: "Create an account" },
    ],
  },
] as const;

export function SiteFooter() {
  return (
    <footer className="relative border-t border-line bg-bg">
      <Container className="grid gap-12 py-16 md:grid-cols-[1.4fr_repeat(3,1fr)] md:py-20">
        <div className="flex flex-col gap-5">
          <Link
            href="/"
            aria-label="AgentOS home"
            className="w-fit rounded-md focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none"
          >
            <Wordmark />
          </Link>
          <p className="max-w-xs text-sm leading-relaxed text-fg-muted">
            The operating system for AI that takes action — planned, permissioned, verified and audited.
          </p>
          <p className="font-mono text-2xs leading-relaxed tracking-wide text-fg-subtle">
            LLM proposes · Backend decides · Tools execute · <span className="text-verify">Verifier confirms</span>
          </p>
        </div>
        {COLUMNS.map((col) => (
          <nav key={col.title} aria-label={col.title}>
            <h2 className="font-mono text-2xs tracking-[0.2em] text-fg-subtle uppercase">{col.title}</h2>
            <ul className="mt-4 flex flex-col gap-2.5">
              {col.links.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    className="rounded-sm text-sm text-fg-muted transition-colors hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </Container>
      <Container className="flex flex-col gap-3 border-t border-line py-6 text-xs text-fg-subtle sm:flex-row sm:items-center sm:justify-between">
        <p>© {new Date().getFullYear()} AgentOS</p>
        <p className="font-mono text-2xs tracking-wide">
          Every action policy-checked, approved when it matters, verified and audited.
        </p>
      </Container>
    </footer>
  );
}
