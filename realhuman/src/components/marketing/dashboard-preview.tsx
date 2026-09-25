import {
  Activity,
  KeyRound,
  LayoutDashboard,
  ScrollText,
  Settings,
  Waypoints,
  Webhook,
} from "lucide-react";
import Link from "next/link";
import { EventsList } from "@/components/dashboard/events-list";
import { MetricCard } from "@/components/dashboard/metric-card";
import { BrowserFrame } from "@/components/demo/browser-frame";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonArrow } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { Reveal } from "@/components/ui/reveal";
import { SectionHeading } from "@/components/ui/section-heading";
import { ActivityChart } from "@/components/visuals/activity-chart";
import { buildEvents, buildOverview } from "@/lib/api/mock/fixtures";
import { dashboardPreview } from "@/lib/constants/content";
import { routes } from "@/lib/constants/site";
import { cn } from "@/lib/utils/cn";

const overview = buildOverview();
const events = buildEvents(6);
const recent = overview.activity.slice(-7);

const RAIL = [LayoutDashboard, Activity, Waypoints, KeyRound, Webhook, ScrollText, Settings];

export function DashboardPreview() {
  return (
    <section id="dashboard" aria-labelledby="dashboard-title" className="relative py-section">
      <Container size="wide">
        <SectionHeading
          id="dashboard-title"
          eyebrow={dashboardPreview.eyebrow}
          title={dashboardPreview.title}
          description={dashboardPreview.body}
          align="center"
        />

        <Reveal y={28} className="relative mt-12">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-[10%] -top-16 -z-10 h-80 [--glow:rgb(94_169_247/0.1)] glow"
          />
          <BrowserFrame
            url="dashboard · demo workspace"
            aside={
              <Badge tone="warning" size="sm">
                Sample data
              </Badge>
            }
          >
            <div className="flex">
              <nav
                aria-label="Dashboard preview navigation"
                className="hidden w-14 shrink-0 flex-col items-center gap-1 border-r border-border py-4 sm:flex"
              >
                {RAIL.map((Icon, index) => (
                  <span
                    key={index}
                    aria-hidden
                    className={cn(
                      "inline-flex size-9 items-center justify-center rounded-lg",
                      index === 0 ? "bg-surface-overlay text-foreground" : "text-subtle",
                    )}
                  >
                    <Icon className="size-4" />
                  </span>
                ))}
              </nav>

              <div className="flex min-w-0 flex-1 flex-col gap-5 p-4 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-[15px] font-semibold tracking-tight">Overview</p>
                    <p className="text-xs text-subtle">
                      Last 7 days · compared with the previous 7
                    </p>
                  </div>
                  <Badge tone="neutral" size="sm" dot>
                    Mock adapter
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <MetricCard
                    label="Verification volume"
                    metric={overview.metrics.volume}
                    trend={recent.map((d) => d.verified + d.suspicious + d.blocked)}
                  />
                  <MetricCard
                    label="Verified sessions"
                    metric={overview.metrics.verified}
                    trend={recent.map((d) => d.verified)}
                    tone="success"
                  />
                  <MetricCard
                    label="Suspicious sessions"
                    metric={overview.metrics.suspicious}
                    trend={recent.map((d) => d.suspicious)}
                    tone="warning"
                  />
                  <MetricCard
                    label="Blocked events"
                    metric={overview.metrics.blocked}
                    trend={recent.map((d) => d.blocked)}
                    tone="danger"
                  />
                </div>

                <div className="grid gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
                  <div className="min-w-0 rounded-xl border border-border bg-surface p-4">
                    <p className="mb-3 text-[13px] font-medium">Verification activity</p>
                    <ActivityChart
                      data={overview.activity}
                      title="Verification activity, last 14 days (sample data)"
                      height={250}
                    />
                  </div>
                  <div className="min-w-0 rounded-xl border border-border bg-surface p-4">
                    <p className="text-[13px] font-medium">Recent events</p>
                    <EventsList events={events} />
                  </div>
                </div>
              </div>
            </div>
          </BrowserFrame>

          <div className="mt-8 flex justify-center">
            <Button asChild variant="secondary">
              <Link href={routes.dashboard}>
                Open the dashboard
                <ButtonArrow />
              </Link>
            </Button>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
