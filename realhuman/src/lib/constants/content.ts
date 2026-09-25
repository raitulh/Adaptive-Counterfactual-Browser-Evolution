import {
  AppWindow,
  Braces,
  BrainCircuit,
  Fingerprint,
  Hand,
  Layers,
  type LucideIcon,
  ScanLine,
  ShieldCheck,
  SlidersHorizontal,
  Store,
  Ticket,
  Users,
  Waypoints,
  Lock,
  Minimize2,
} from "lucide-react";

/**
 * Marketing copy. Every claim here must describe designed product behavior —
 * no customer names, certifications, benchmarks or adoption numbers.
 */

export const hero = {
  badge: "Human verification for the AI era",
  headlineLead: "Know when you are talking to",
  headlineEmphasis: "a human.",
  body: "RealHuman combines lightweight challenges with session and behavior signals to give your product a clear, policy-driven decision — for signups, logins, checkouts, APIs and the workflows AI agents now reach.",
  trust: ["API-first", "Privacy by design", "Works alongside existing CAPTCHA"],
} as const;

export interface ValueProp {
  icon: LucideIcon;
  title: string;
  body: string;
}

export const valueProps: readonly ValueProp[] = [
  {
    icon: Layers,
    title: "Decisions, not puzzles",
    body: "Challenges follow your policy, so low-risk sessions see less friction and ambiguous ones get a second look.",
  },
  {
    icon: Braces,
    title: "API-first",
    body: "Typed REST endpoints and a thin server SDK. Redeem tokens where your business logic already lives.",
  },
  {
    icon: Fingerprint,
    title: "Privacy by design",
    body: "Collect only what the configured flow needs. No biometrics, and retention is set per project.",
  },
  {
    icon: Waypoints,
    title: "Agent-aware",
    body: "Separate two questions — who is acting, and whether to allow it — so trusted automation has an explicit path.",
  },
];

export const problem = {
  eyebrow: "The problem",
  title: "Automation got better at looking human.",
  body: "Scripted browsers, automated signups and AI agents now complete flows that were designed for people. Some of that automation is welcome. Some of it is abuse. Legacy challenges treat every visitor as a suspect — and still can't tell your backend which is which.",
  actors: ["Scripted browsers", "Automated signups", "Bot traffic", "AI agents", "Abuse workflows"],
  legacy: {
    title: "Legacy challenge",
    points: [
      "One puzzle for every visitor",
      "Pass or fail on a single test",
      "Friction lands on real people",
      "No context for your backend",
    ],
  },
  modern: {
    title: "Signal-based verification",
    points: [
      "Challenges sized to the session's risk",
      "Several signals, one weighted decision",
      "Less friction for low-risk sessions",
      "A typed result your server can act on",
    ],
  },
  footnote:
    "No verification system stops all automation. RealHuman is designed to make abuse more expensive while keeping the path clear for people.",
} as const;

export interface Step {
  number: string;
  title: string;
  body: string;
  icon: LucideIcon;
  detail: string;
}

export const steps: readonly Step[] = [
  {
    number: "01",
    title: "Challenge",
    icon: Hand,
    body: "Issue a lightweight challenge sized to the session's risk — a single interaction for most sessions, a step-up when signals are ambiguous.",
    detail: "POST /v1/sessions",
  },
  {
    number: "02",
    title: "Analyze",
    icon: ScanLine,
    body: "Combine interaction, challenge, session and request signals into one weighted score. Each signal contributes; none decides alone.",
    detail: "signals → score",
  },
  {
    number: "03",
    title: "Verify",
    icon: ShieldCheck,
    body: "Return a decision and a single-use token. Your server redeems the token and enforces the outcome with its own policy.",
    detail: "POST /v1/verify",
  },
];

export const signalEngine = {
  eyebrow: "Signal engine",
  title: "No single signal decides.",
  body: "Every verification combines independent signals into one weighted score, then applies your policy. A strong challenge response can't outvote an inconsistent session, and one ambiguous signal triggers a step-up instead of a block.",
  points: [
    "Weighted aggregation you can tune per project",
    "Step-up challenges instead of hard failures",
    "Every decision returns the signals behind it",
  ],
} as const;

export const developer = {
  eyebrow: "Developers",
  title: "Verify on your server. Decide in your code.",
  body: "Render the widget with a public site key, send the token to your backend, and redeem it once with your secret key. The response is typed, explainable and small enough to log.",
  features: [
    { title: "Single-use tokens", body: "Each token is redeemed once, server-side." },
    { title: "Typed responses", body: "verified, risk, score and signals — every time." },
    { title: "Mock mode", body: "Deterministic results for local development." },
    { title: "REST first", body: "SDKs are thin wrappers over the same endpoints." },
  ],
  footnote: "Examples reflect the beta API contract and may change before general availability.",
} as const;

export interface UseCase {
  slug: string;
  icon: LucideIcon;
  title: string;
  body: string;
}

export const useCases: readonly UseCase[] = [
  {
    slug: "ai-platforms",
    icon: BrainCircuit,
    title: "AI platforms",
    body: "Keep free tiers and inference quotas for people, and give trusted agents an explicit, authorized path.",
  },
  {
    slug: "saas",
    icon: AppWindow,
    title: "SaaS",
    body: "Protect signups, trials and invitations without adding friction for legitimate users.",
  },
  {
    slug: "marketplaces",
    icon: Store,
    title: "Marketplaces",
    body: "Make fake listings, review manipulation and automated account creation harder to scale.",
  },
  {
    slug: "communities",
    icon: Users,
    title: "Communities",
    body: "Verify at signup and before high-impact actions so conversations stay between people.",
  },
  {
    slug: "apis",
    icon: Braces,
    title: "APIs",
    body: "Gate sensitive endpoints behind verification tokens your backend checks before doing work.",
  },
  {
    slug: "online-events",
    icon: Ticket,
    title: "Online events",
    body: "Keep ticket drops, registrations and live Q&A open to the people who actually show up.",
  },
];

export interface Principle {
  label: string;
  icon: LucideIcon;
  title: string;
  body: string;
}

export const security = {
  eyebrow: "Security & privacy",
  title: "Verification that respects the person being verified.",
  body: "Verification data is sensitive by nature. RealHuman is designed around data minimization: collect what the configured flow needs, keep it briefly, and give you control over every decision.",
  principles: [
    {
      label: "Minimize",
      icon: Minimize2,
      title: "Collect only what is needed.",
      body: "Signals are derived from the interaction and session in progress. Biometrics are never required, and the challenge does not ask for personal information.",
    },
    {
      label: "Protect",
      icon: Lock,
      title: "Treat verification data as sensitive.",
      body: "Tokens are short-lived and single-use. Secret keys stay on your server; the browser only ever holds a public site key.",
    },
    {
      label: "Control",
      icon: SlidersHorizontal,
      title: "Predictable policies, owned by you.",
      body: "Thresholds, step-up behavior and retention are configured per project, and every decision returns the signals that produced it.",
    },
  ] satisfies Principle[],
  details: [
    {
      id: "session-lifecycle",
      title: "Session lifecycle",
      body: "A session is created when the widget loads, carries a short time-to-live, and ends when a token is issued or the session expires. Expired sessions cannot be resumed — the widget starts a new one. Tokens are bound to the session that produced them and can be redeemed once.",
    },
    {
      id: "retention",
      title: "Retention",
      body: "Each project has a retention setting for session records. Choose the shortest window that still supports debugging and abuse review; records older than the window are removed from the dashboard and API.",
    },
    {
      id: "transport-security",
      title: "Transport security",
      body: "The API is designed to be served over HTTPS only. Secret keys authenticate server-to-server calls and must never be shipped to browsers. The widget authenticates with a public site key that cannot redeem tokens.",
    },
    {
      id: "policy-controls",
      title: "Policy controls",
      body: "Allow and step-up thresholds, signal weights and challenge types are set per project and applied consistently to every session. The decision returned for each session records the score and signals it was based on.",
    },
  ],
  complianceNote:
    "RealHuman does not currently claim certification against any regulatory or industry framework. If you have specific requirements, talk to us before you integrate.",
} as const;

export const dashboardPreview = {
  eyebrow: "Dashboard",
  title: "See every decision, and why it was made.",
  body: "Volume, outcomes and recent sessions in one place — with the signals behind each decision a click away.",
} as const;

export interface PricingTier {
  id: "beta" | "startup" | "enterprise";
  name: string;
  price: string;
  priceNote: string;
  description: string;
  features: readonly string[];
  cta: { label: string; kind: "signup" | "contact" };
  featured?: boolean;
}

export const pricing = {
  eyebrow: "Pricing",
  title: "Start free during the beta.",
  body: "Build and test your integration at no cost. Plans for production traffic are set with you while pricing is finalized.",
  tiers: [
    {
      id: "beta",
      name: "Beta",
      price: "Free",
      priceNote: "during the beta",
      description: "For developers building and testing an integration.",
      features: [
        "Mock and live API access",
        "Hosted verification widget",
        "Dashboard, logs and webhooks",
        "Community support",
      ],
      cta: { label: "Start Building", kind: "signup" },
      featured: true,
    },
    {
      id: "startup",
      name: "Startup",
      price: "Custom",
      priceNote: "based on your volume",
      description: "For products taking verification into production.",
      features: [
        "Everything in Beta",
        "Policy tuning and step-up flows",
        "Production request limits",
        "Email support",
      ],
      cta: { label: "Talk to us", kind: "contact" },
    },
    {
      id: "enterprise",
      name: "Enterprise",
      price: "Custom",
      priceNote: "annual agreement",
      description: "For teams with security review, retention or deployment requirements.",
      features: [
        "Custom retention and data handling",
        "Security questionnaire support",
        "Deployment options on request",
        "Named support contact",
      ],
      cta: { label: "Contact sales", kind: "contact" },
    },
  ] satisfies PricingTier[],
  footnote: "Final pricing will be published before general availability.",
} as const;

export interface FaqItem {
  id: string;
  question: string;
  answer: string;
}

export const faq: readonly FaqItem[] = [
  {
    id: "how-it-works",
    question: "How does verification work?",
    answer:
      "The widget creates a short-lived session, issues a lightweight challenge, and collects signals about the interaction and the session. RealHuman combines those signals into a score, applies your policy, and returns a decision with a single-use token. Your server redeems the token and decides what happens next.",
  },
  {
    id: "biometrics",
    question: "Is biometrics required?",
    answer:
      "No. RealHuman does not require face scans, fingerprints or any other biometric data. Challenges rely on interaction and session signals only.",
  },
  {
    id: "data",
    question: "What data is processed?",
    answer:
      "Signals derived from the verification session: how and when the challenge was completed, session properties needed to check consistency, and request metadata such as cadence. The aim is the minimum needed to reach a decision, and retention is configurable per project.",
  },
  {
    id: "captcha",
    question: "Can it work with an existing CAPTCHA?",
    answer:
      "Yes. You can run RealHuman alongside an existing CAPTCHA — on a share of traffic, or as a step-up — and compare outcomes before you switch.",
  },
  {
    id: "api",
    question: "How does API integration work?",
    answer:
      "Render the widget with your public site key, send the resulting token to your backend, and call the verify endpoint with your secret key. The response includes verified, risk, score and signals. The REST API is the primary interface; SDKs are thin wrappers around it.",
  },
  {
    id: "mock-mode",
    question: "How does mock mode differ from production?",
    answer:
      "Mock mode runs entirely in the browser with deterministic, simulated results, so you can build and test UI flows without a backend. It provides no protection. Production verification runs server-side on live signals and returns tokens your backend can redeem.",
  },
  {
    id: "agents",
    question: "Can it be used with AI-agent workflows?",
    answer:
      "Yes. Verification tells you whether a session shows signals consistent with a person; your policy decides what to do with that. Require verification before sensitive actions an agent might attempt, or give known agents an explicit path through your own authorization.",
  },
];

export const finalCta = {
  titleLead: "Build for humans.",
  titleTail: "Prepare for agents.",
  body: "Start in mock mode today, and connect the live API when you are ready.",
} as const;
