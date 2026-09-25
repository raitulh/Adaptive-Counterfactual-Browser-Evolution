import { BookOpen } from "lucide-react";
import Link from "next/link";
import { LiveDemo } from "@/components/demo/live-demo";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { Reveal } from "@/components/ui/reveal";
import { SectionHeading } from "@/components/ui/section-heading";
import { EmptyState } from "@/components/ui/states";
import { env } from "@/lib/env";

export function DemoSection() {
  return (
    <section id="demo" aria-labelledby="demo-title" className="relative py-section">
      <Container size="wide">
        <SectionHeading
          id="demo-title"
          eyebrow="Live demo"
          title="See a verification happen."
          description="Complete the challenge in the example signup form and watch the same session from your backend's point of view: signals as they resolve, the decision, and the token."
          align="center"
        />
        <Reveal className="mt-12" y={20}>
          {env.NEXT_PUBLIC_ENABLE_DEMO ? (
            <LiveDemo />
          ) : (
            <EmptyState
              title="The interactive demo is turned off for this deployment."
              description="Read how the verification flow works in the documentation."
              action={
                <Button asChild variant="secondary" size="sm">
                  <Link href="/docs#verification-flow">
                    <BookOpen aria-hidden />
                    Verification flow
                  </Link>
                </Button>
              }
            />
          )}
        </Reveal>
      </Container>
    </section>
  );
}
