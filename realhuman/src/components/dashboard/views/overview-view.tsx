"use client";

import Link from "next/link";
import { EventsList } from "@/components/dashboard/events-list";
import { MetricCard } from "@/components/dashboard/metric-card";
import { MockNotice } from "@/components/dashboard/mock-notice";
import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/primitives";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { ActivityChart } from "@/components/visuals/activity-chart";
import { useOverview, useRecentEvents } from "@/hooks/use-dashboard-data";
import { toApiError } from "@/lib/api";

export function OverviewView() {
  const overview = useOverview();
  const events = useRecentEvents(8);

  return (
    <>
      <PageHeader
        title="Overview"
        description="Verification outcomes for this workspace."
        actions={<Badge size="md">Last 7 days</Badge>}
      />
      <MockNotice />

      {overview.isPending ? (
        <div className="flex flex-col gap-4" aria-busy>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-[8.5rem] rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-80 rounded-xl" />
          <span className="sr-only" role="status">
            Loading overview…
          </span>
        </div>
      ) : overview.isError ? (
        <ErrorState
          title="Couldn't load the overview"
          description={toApiError(overview.error).message}
          onRetry={() => void overview.refetch()}
        />
      ) : (
        <>
          <section aria-label="Key metrics" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {(() => {
              const recent = overview.data.activity.slice(-7);
              const { metrics } = overview.data;
              return (
                <>
                  <MetricCard
                    label="Verification volume"
                    metric={metrics.volume}
                    trend={recent.map((d) => d.verified + d.suspicious + d.blocked)}
                  />
                  <MetricCard
                    label="Verified sessions"
                    metric={metrics.verified}
                    trend={recent.map((d) => d.verified)}
                    tone="success"
                  />
                  <MetricCard
                    label="Suspicious sessions"
                    metric={metrics.suspicious}
                    trend={recent.map((d) => d.suspicious)}
                    tone="warning"
                  />
                  <MetricCard
                    label="Blocked events"
                    metric={metrics.blocked}
                    trend={recent.map((d) => d.blocked)}
                    tone="danger"
                  />
                </>
              );
            })()}
          </section>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)]">
            <section
              aria-labelledby="activity-title"
              className="min-w-0 rounded-xl border border-border bg-surface p-5"
            >
              <h2 id="activity-title" className="mb-4 text-sm font-medium">
                Verification activity
              </h2>
              <ActivityChart
                data={overview.data.activity}
                title="Verification activity, last 14 days"
                height={290}
              />
            </section>

            <section
              aria-labelledby="events-title"
              className="min-w-0 rounded-xl border border-border bg-surface p-5"
            >
              <div className="flex items-center justify-between">
                <h2 id="events-title" className="text-sm font-medium">
                  Recent events
                </h2>
                <Button asChild variant="ghost" size="sm">
                  <Link href="/dashboard/sessions">View all</Link>
                </Button>
              </div>
              {events.isPending ? (
                <LoadingState rows={5} label="Loading events" className="mt-3" />
              ) : events.isError ? (
                <ErrorState
                  title="Couldn't load events"
                  onRetry={() => void events.refetch()}
                  className="mt-3 py-8"
                />
              ) : events.data.length === 0 ? (
                <EmptyState
                  title="No events yet"
                  description="Events appear as sessions complete."
                  className="mt-3 py-8"
                />
              ) : (
                <EventsList events={events.data} />
              )}
            </section>
          </div>
        </>
      )}
    </>
  );
}
