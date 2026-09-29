import Link from "next/link";

// Scaffold: replaced by the cinematic landing page.
export default function HomePage() {
  return (
    <main id="main" className="flex min-h-dvh items-center justify-center">
      <Link href="/app" className="text-accent underline">
        Open AgentOS
      </Link>
    </main>
  );
}
