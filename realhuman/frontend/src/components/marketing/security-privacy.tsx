import { Info } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Container } from "@/components/ui/container";
import { Reveal } from "@/components/ui/reveal";
import { SectionHeading } from "@/components/ui/section-heading";
import { security } from "@/lib/constants/content";

/** Abstract shield built from the same thin lines as the rest of the system. */
function ShieldMotif() {
  return (
    <svg viewBox="0 0 120 132" aria-hidden className="h-auto w-full max-w-[15rem]">
      <path
        d="M60 4 108 22v38c0 32-20 56-48 68C32 116 12 92 12 60V22Z"
        className="fill-surface stroke-border-strong"
        strokeWidth="1"
      />
      <path
        d="M60 18 94 31v29c0 23-14 41-34 50-20-9-34-27-34-50V31Z"
        className="fill-none stroke-border"
        strokeWidth="1"
        strokeDasharray="3 4"
      />
      <circle cx="26" cy="46" r="2" className="fill-accent" />
      <circle cx="94" cy="46" r="2" className="fill-faint" />
      <circle cx="60" cy="110" r="2" className="fill-faint" />
      <path
        d="M47 62l9 9 17-18"
        className="fill-none stroke-success"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="60" cy="4" r="3" className="fill-accent" />
    </svg>
  );
}

export function SecurityPrivacy() {
  return (
    <section
      id="security"
      aria-labelledby="security-title"
      className="border-y border-border bg-surface/30 py-section"
    >
      <Container size="wide">
        <div className="grid items-end gap-10 lg:grid-cols-[1.4fr_1fr]">
          <SectionHeading
            id="security-title"
            eyebrow={security.eyebrow}
            title={security.title}
            description={security.body}
          />
          <Reveal className="hidden justify-end lg:flex" delay={0.1}>
            <ShieldMotif />
          </Reveal>
        </div>

        <ul className="mt-14 grid gap-4 md:grid-cols-3">
          {security.principles.map(({ label, icon: Icon, title, body }, index) => (
            <li key={label}>
              <Reveal
                delay={index * 0.07}
                className="flex h-full flex-col gap-5 rounded-2xl border border-border bg-background p-6"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs tracking-[0.18em] text-accent uppercase">
                    {label}
                  </span>
                  <Icon aria-hidden className="size-[18px] text-subtle" />
                </div>
                <div className="flex flex-col gap-2">
                  <h3 className="text-h3">{title}</h3>
                  <p className="text-sm text-muted">{body}</p>
                </div>
              </Reveal>
            </li>
          ))}
        </ul>

        <div className="mt-14 grid gap-10 lg:grid-cols-[1fr_1.6fr]">
          <Reveal className="flex flex-col gap-3">
            <h3 className="text-h3">Technical details</h3>
            <p className="text-sm text-muted">
              How sessions, retention, transport and policies are designed to work.
            </p>
          </Reveal>
          <Reveal delay={0.06}>
            <Accordion type="multiple" className="border-t border-border">
              {security.details.map((detail) => (
                <AccordionItem key={detail.id} value={detail.id}>
                  <AccordionTrigger>{detail.title}</AccordionTrigger>
                  <AccordionContent>{detail.body}</AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
            <p className="mt-6 flex items-start gap-2 text-xs text-subtle">
              <Info aria-hidden className="mt-px size-3.5 shrink-0" />
              {security.complianceNote}
            </p>
          </Reveal>
        </div>
      </Container>
    </section>
  );
}
