import Link from "next/link";

import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import {
  schedulePeriodSummarySchema,
  type SchedulePeriodSummary,
} from "@/lib/schemas/schedule";

function createSchedulePeriods(): SchedulePeriodSummary[] {
  const periods = [
    {
      id: "week-of-may-4",
      name: "Week of May 4",
      dateRange: "May 4-10, 2026",
      currentVersionName: "Working version",
      lastEditedAt: "2026-04-30T14:41:00.000Z",
      lastPublishedAt: "2026-04-30T09:12:00.000Z",
      unpublishedChangeCount: 3,
    },
    {
      id: "week-of-april-27",
      name: "Week of April 27",
      dateRange: "Apr 27-May 3, 2026",
      currentVersionName: "Published version",
      lastEditedAt: "2026-04-29T18:05:00.000Z",
      lastPublishedAt: "2026-04-29T18:05:00.000Z",
      unpublishedChangeCount: 0,
    },
  ];
  const parsedPeriods = periods.map((period) => {
    const parsedPeriod = schedulePeriodSummarySchema.parse(period);
    return parsedPeriod;
  });
  return parsedPeriods;
}

function formatScheduleDate(value: string) {
  const date = new Date(value);
  const formatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const formattedValue = formatter.format(date);
  return formattedValue;
}

function publishStatus(period: SchedulePeriodSummary) {
  if (period.lastPublishedAt === null) {
    return "Never published";
  }

  if (period.unpublishedChangeCount > 0) {
    return "Published with unpublished edits";
  }

  return "Published";
}

export default function SchedulesPage() {
  const periods = createSchedulePeriods();

  return (
    <AppShell>
      <PageHeader
        title="Schedules"
        description="Choose a schedule period, open it in its own workspace, and track publish history over time."
      />
      <section className="rounded-md border border-slate-200 bg-white">
        <div className="hidden grid-cols-[minmax(0,1.2fr)_minmax(10rem,0.7fr)_minmax(9rem,0.6fr)_auto] border-b border-slate-200 px-4 py-3 text-xs font-semibold uppercase text-slate-500 lg:grid">
          <span>Schedule period</span>
          <span>Status</span>
          <span>Last publish</span>
          <span className="text-right">Action</span>
        </div>
        <div className="divide-y divide-slate-200">
          {periods.map((period) => {
            const status = publishStatus(period);
            const lastPublished =
              period.lastPublishedAt === null
                ? "Not published"
                : formatScheduleDate(period.lastPublishedAt);
            return (
              <div
                key={period.id}
                className="grid gap-4 px-4 py-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(10rem,0.7fr)_minmax(9rem,0.6fr)_auto] lg:items-center"
              >
                <div>
                  <h3 className="text-sm font-semibold text-slate-950">
                    {period.name}
                  </h3>
                  <p className="text-sm text-slate-500">{period.dateRange}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {period.currentVersionName} edited{" "}
                    {formatScheduleDate(period.lastEditedAt)}
                  </p>
                </div>
                <div>
                  <span className="inline-flex rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                    {status}
                  </span>
                  {period.unpublishedChangeCount > 0 ? (
                    <p className="mt-1 text-xs text-slate-500">
                      {period.unpublishedChangeCount} unpublished edits
                    </p>
                  ) : null}
                </div>
                <p className="text-sm text-slate-600">{lastPublished}</p>
                <Link
                  href={`/schedules/${period.id}`}
                  className="inline-flex h-9 items-center justify-center rounded-md bg-teal-700 px-3 text-sm font-semibold text-white hover:bg-teal-800 lg:justify-self-end"
                >
                  Open
                </Link>
              </div>
            );
          })}
        </div>
      </section>
    </AppShell>
  );
}
