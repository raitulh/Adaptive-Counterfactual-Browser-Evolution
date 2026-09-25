import { BookOpen } from "lucide-react";
import Link from "next/link";
import { CodeShowcase } from "@/components/marketing/code-showcase";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { Reveal } from "@/components/ui/reveal";
import { SectionHeading } from "@/components/ui/section-heading";
import { developer } from "@/lib/constants/content";
import { routes } from "@/lib/constants/site";

export function DeveloperApi() {
  return (
    <section id="developers" aria-labelledby="developers-title" className="relative py-section">
      <div
        aria-hidden
        className="pointer-events-none absolute top-1/3 right-0 -z-10 h-[40rem] w-[50rem] [--glow:rgb(94_169_247/0.07)] glow"
      />
      <Container size="wide">
        <div className="grid gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16">
          <div className="flex flex-col gap-8">
            <SectionHeading
              id="developers-title"
              eyebrow={developer.eyebrow}
              title={developer.title}
              description={developer.body}
            />
            <Reveal delay={0.08}>
              <dl className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
                {developer.features.map((feature) => (
                  <div
                    key={feature.title}
                    className="flex flex-col gap-1 border-l border-border-strong pl-4"
                  >
                    <dt className="text-sm font-medium">{feature.title}</dt>
                    <dd className="text-sm text-muted">{feature.body}</dd>
                  </div>
                ))}
              </dl>
            </Reveal>
            <Reveal delay={0.12} className="flex flex-col items-start gap-4">
              <Button asChild variant="secondary">
                <Link href={routes.docs}>
                  <BookOpen aria-hidden />
                  Read the documentation
                </Link>
              </Button>
              <p className="text-xs text-subtle">{developer.footnote}</p>
            </Reveal>
          </div>

          <Reveal y={24} delay={0.05} className="min-w-0">
            <CodeShowcase />
          </Reveal>
        </div>
      </Container>
    </section>
  );
}
