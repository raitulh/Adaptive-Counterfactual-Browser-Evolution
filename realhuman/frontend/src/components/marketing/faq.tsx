import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Container } from "@/components/ui/container";
import { Reveal } from "@/components/ui/reveal";
import { SectionHeading } from "@/components/ui/section-heading";
import { faq } from "@/lib/constants/content";

export function Faq() {
  return (
    <section id="faq" aria-labelledby="faq-title" className="py-section">
      <Container size="wide">
        <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
          <SectionHeading
            id="faq-title"
            eyebrow="FAQ"
            title="Questions, answered plainly."
            description="What RealHuman does, what it collects, and how it fits next to what you already run."
          />
          <Reveal delay={0.06}>
            <Accordion type="single" collapsible className="border-t border-border">
              {faq.map((item) => (
                <AccordionItem key={item.id} value={item.id}>
                  <AccordionTrigger>{item.question}</AccordionTrigger>
                  <AccordionContent>{item.answer}</AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </Reveal>
        </div>
      </Container>
    </section>
  );
}
