import { Container } from "@/components/ui/container";
import { Reveal } from "@/components/ui/reveal";
import { valueProps } from "@/lib/constants/content";

export function ValueStrip() {
  return (
    <section aria-labelledby="values-title" className="border-y border-border bg-background">
      <h2 id="values-title" className="sr-only">
        Why teams choose signal-based verification
      </h2>
      <Container size="wide">
        <ul className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-4">
          {valueProps.map(({ icon: Icon, title, body }, index) => (
            <li key={title} className="bg-background px-1 py-8 sm:px-6">
              <Reveal delay={index * 0.06} className="flex flex-col gap-3">
                <Icon aria-hidden className="size-5 text-accent" />
                <h3 className="text-[15px] font-semibold tracking-tight">{title}</h3>
                <p className="text-sm text-muted">{body}</p>
              </Reveal>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
