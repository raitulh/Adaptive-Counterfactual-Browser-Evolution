import { Check } from "lucide-react";
import Link from "next/link";
import { ContactDialog } from "@/components/marketing/contact-dialog";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonArrow } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { Reveal } from "@/components/ui/reveal";
import { SectionHeading } from "@/components/ui/section-heading";
import { pricing } from "@/lib/constants/content";
import { routes } from "@/lib/constants/site";
import { cn } from "@/lib/utils/cn";

export function Pricing() {
  return (
    <section id="pricing" aria-labelledby="pricing-title" className="py-section">
      <Container size="wide">
        <SectionHeading
          id="pricing-title"
          eyebrow={pricing.eyebrow}
          title={pricing.title}
          description={pricing.body}
          align="center"
        />

        <ul className="mx-auto mt-12 grid max-w-content gap-4 lg:grid-cols-3">
          {pricing.tiers.map((tier, index) => (
            <li key={tier.id}>
              <Reveal
                delay={index * 0.07}
                className={cn(
                  "relative flex h-full flex-col gap-6 rounded-2xl border p-6 sm:p-7",
                  tier.featured
                    ? "border-border-bright bg-surface-raised shadow-elevated"
                    : "border-border bg-surface",
                )}
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-h3">{tier.name}</h3>
                  {tier.featured ? (
                    <Badge tone="accent" size="sm">
                      Open now
                    </Badge>
                  ) : null}
                </div>
                <div className="flex flex-col gap-1">
                  <p className="flex items-baseline gap-2">
                    <span className="text-4xl font-semibold tracking-tight">{tier.price}</span>
                    <span className="text-sm text-subtle">{tier.priceNote}</span>
                  </p>
                  <p className="text-sm text-muted lg:min-h-10">{tier.description}</p>
                </div>
                <ul className="flex flex-1 flex-col gap-3 border-t border-border pt-6">
                  {tier.features.map((feature) => (
                    <li
                      key={feature}
                      className="flex items-start gap-2.5 text-sm text-foreground/90"
                    >
                      <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-muted" />
                      {feature}
                    </li>
                  ))}
                </ul>
                {tier.cta.kind === "signup" ? (
                  <Button asChild size="lg">
                    <Link href={routes.signup}>
                      {tier.cta.label}
                      <ButtonArrow />
                    </Link>
                  </Button>
                ) : (
                  <ContactDialog
                    plan={tier.name}
                    trigger={
                      <Button size="lg" variant="secondary">
                        {tier.cta.label}
                      </Button>
                    }
                  />
                )}
              </Reveal>
            </li>
          ))}
        </ul>
        <p className="mt-8 text-center text-xs text-subtle">{pricing.footnote}</p>
      </Container>
    </section>
  );
}
