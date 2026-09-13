import React from "react";
import { Navbar } from "@/components/layout/Navbar";
import { Hero } from "@/components/landing/Hero";
import { ProofBar } from "@/components/landing/ProofBar";
import { HowToUse } from "@/components/landing/HowToUse";
import { Comparison } from "@/components/landing/Comparison";
import { LoopVisualizer } from "@/components/landing/LoopVisualizer";
import { BentoGrid } from "@/components/landing/BentoGrid";
import { CodePlayground } from "@/components/landing/CodePlayground";
import { Faq } from "@/components/landing/Faq";
import { Footer } from "@/components/layout/Footer";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <Navbar />
      <main className="flex-1">
        <Hero />
        <ProofBar />
        <HowToUse />
        <Comparison />
        <LoopVisualizer />
        <BentoGrid />
        <CodePlayground />
        <Faq />
      </main>
      <Footer />
    </div>
  );
}
