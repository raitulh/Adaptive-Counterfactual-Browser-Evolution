import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { Container } from "@/components/ui/container";
import { Reveal } from "@/components/ui/reveal";
import { SectionHeading } from "@/components/ui/section-heading";
import { useCases } from "@/lib/constants/content";

export function UseCases() {
  return (
    <section id="use-cases" aria-labelledby="use-cases-title" className="py-section">
      <Container size="wide">
        <SectionHeading
          id="use-cases-title"
          eyebrow="Use cases"
          title="Wherever a person should be on the other side."
          description="Add verification to the moments that matter — account creation, high-value actions and scarce resources — and leave the rest of the experience untouched."
        />
        <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {useCases.map(({ slug, icon: Icon, title, body }, index) => (
            <li key={slug}>
              <Reveal delay={(index % 3) * 0.06} className="h-full">
                <Link
                  href={`/docs#use-case-${slug}`}
                  className="group relative flex h-full flex-col gap-4 rounded-2xl border border-border bg-surface p-6 transition-[transform,border-color,background-color,box-shadow] duration-300 ease-out-expo hover:-translate-y-0.5 hover:border-border-strong hover:bg-surface-raised hover:shadow-elevated"
                >
                  <div className="flex items-start justify-between">
                    <span className="inline-flex size-10 items-center justify-center rounded-xl border border-border-strong bg-surface-raised text-foreground transition-colors group-hover:border-accent/30 group-hover:text-accent">
                      <Icon aria-hidden className="size-[18px]" />
                    </span>
                    <ArrowUpRight
                      aria-hidden
                      className="size-4 text-faint transition-[transform,color] duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-foreground"
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <h3 className="text-h3">{title}</h3>
                    <p className="text-sm text-muted">{body}</p>
                  </div>
                </Link>
              </Reveal>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
