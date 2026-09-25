import { Badge } from "@/components/ui/badge";
import type { EventOutcome } from "@/lib/schemas/dashboard";
import type { RiskLevel, SignalStatus } from "@/lib/schemas/verification";

type Tone = "neutral" | "success" | "accent" | "warning" | "danger";

const OUTCOME: Record<EventOutcome, { label: string; tone: Tone }> = {
  verified: { label: "Verified", tone: "success" },
  step_up: { label: "Step-up", tone: "warning" },
  blocked: { label: "Blocked", tone: "danger" },
  expired: { label: "Expired", tone: "neutral" },
};

const RISK: Record<RiskLevel, { label: string; tone: Tone }> = {
  low: { label: "Low risk", tone: "neutral" },
  medium: { label: "Medium risk", tone: "warning" },
  high: { label: "High risk", tone: "danger" },
};

const SIGNAL: Record<SignalStatus, { label: string; tone: Tone }> = {
  pending: { label: "Pending", tone: "neutral" },
  pass: { label: "Pass", tone: "accent" },
  review: { label: "Review", tone: "warning" },
  fail: { label: "Fail", tone: "danger" },
};

export function OutcomeBadge({ outcome }: { outcome: EventOutcome }) {
  const { label, tone } = OUTCOME[outcome];
  return (
    <Badge tone={tone} size="sm" dot>
      {label}
    </Badge>
  );
}

export function RiskBadge({ risk }: { risk: RiskLevel }) {
  const { label, tone } = RISK[risk];
  return (
    <Badge tone={tone} size="sm">
      {label}
    </Badge>
  );
}

export function SignalBadge({ status }: { status: SignalStatus }) {
  const { label, tone } = SIGNAL[status];
  return (
    <Badge tone={tone} size="sm">
      {label}
    </Badge>
  );
}

export function HttpStatusBadge({ status }: { status: number }) {
  const tone: Tone = status >= 500 ? "danger" : status >= 400 ? "warning" : "accent";
  return (
    <Badge tone={tone} size="sm" className="font-mono tabular-nums">
      {status}
    </Badge>
  );
}

export const outcomeLabel = (outcome: EventOutcome) => OUTCOME[outcome].label;
