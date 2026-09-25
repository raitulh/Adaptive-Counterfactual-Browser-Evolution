import { BookOpen } from "lucide-react";
import Link from "next/link";
import { Button, ButtonArrow } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { Reveal } from "@/components/ui/reveal";
import { VerificationRing } from "@/components/visuals/verification-ring";
import { finalCta } from "@/lib/constants/content";
import { routes } from "@/lib/constants/site";

export function FinalCta() {
  return (
    <section
      aria-labelledby="cta-title"
      className="relative isolate overflow-hidden border-t border-border py-section"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 flex items-center justify-center"
      >
        <VerificationRing className="w-[52rem] max-w-none opacity-80" />
        <div className="absolute size-[36rem] [--glow:rgb(62_227_154/0.07)] glow" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_40%,var(--color-background)_82%)]" />
      </div>
      <Container size="narrow" className="flex flex-col items-center gap-8 py-10 text-center">
        <Reveal className="flex flex-col items-center gap-6">
          <h2 id="cta-title" className="text-h1 text-balance">
            {finalCta.titleLead}
            <br />
            <span className="text-muted">{finalCta.titleTail}</span>
          </h2>
          <p className="max-w-md text-body-lg text-muted">{finalCta.body}</p>
        </Reveal>
        <Reveal delay={0.08} className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
          <Button asChild size="lg">
            <Link href={routes.signup}>
              Start Building
              <ButtonArrow />
            </Link>
          </Button>
          <Button asChild size="lg" variant="secondary">
            <Link href={routes.docs}>
              <BookOpen aria-hidden />
              Explore Docs
            </Link>
          </Button>
        </Reveal>
      </Container>
    </section>
  );
}
