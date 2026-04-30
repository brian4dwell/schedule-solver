import Link from "next/link";

import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { listSchedulePeriods, listScheduleVersions } from "@/lib/api";
import type {
  PersistedScheduleVersionApi,
  SchedulePeriodApi,
  SchedulePeriodSummary,
} from "@/lib/schemas/schedule";
import { schedulePeriodSummarySchema } from "@/lib/schemas/schedule";

function formatDateRange(period: SchedulePeriodApi) {
  const startDate = new Date(`${period.start_date}T00:00:00`);
  const endDate = new Date(`${period.end_date}T00:00:00`);
  const formatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const formattedStart = formatter.format(startDate);
  const formattedEnd = formatter.format(endDate);
  const range = `${formattedStart} - ${formattedEnd}`;
  return range;
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

function latestVersionName(version: PersistedScheduleVersionApi | undefined) {
  if (version === undefined) {
    return "No saved version";
  }

  const name = `Version ${version.version_number}`;
  return name;
}

function latestPublishedAt(versions: PersistedScheduleVersionApi[]) {
  const publishedVersions = versions.filter((version) => {
    return version.published_at !== null;
  });
  const sortedVersions = publishedVersions.toSorted((first, second) => {
    const firstValue = first.published_at ?? "";
    const secondValue = second.published_at ?? "";
    const comparison = firstValue.localeCompare(secondValue);
    return comparison;
  });
  const latestVersion = sortedVersions.at(-1);
  const publishedAt = latestVersion?.published_at ?? null;
  return publishedAt;
}

function unpublishedChangeCount(versions: PersistedScheduleVersionApi[]) {
  const draftVersions = versions.filter((version) => {
    return version.status === "draft";
  });
  const count = draftVersions.length;
  return count;
}

function createSchedulePeriodSummary(
  period: SchedulePeriodApi,
  versions: PersistedScheduleVersionApi[],
): SchedulePeriodSummary {
  const latestVersion = versions.at(0);
  const lastEditedAt = latestVersion?.updated_at ?? period.updated_at;
  const summary = {
    id: period.id,
    name: period.name,
    dateRange: formatDateRange(period),
    currentVersionName: latestVersionName(latestVersion),
    lastEditedAt,
    lastPublishedAt: latestPublishedAt(versions),
    unpublishedChangeCount: unpublishedChangeCount(versions),
  };
  const parsedSummary = schedulePeriodSummarySchema.parse(summary);
  return parsedSummary;
}

function publishStatus(period: SchedulePeriodSummary) {
  if (period.lastPublishedAt === null) {
    return "Never published";
  }

  if (period.unpublishedChangeCount > 0) {
    return "Published with draft versions";
  }

  return "Published";
}

async function loadSchedulePeriodSummaries() {
  const periods = await listSchedulePeriods();
  const periodSummaries = await Promise.all(
    periods.map(async (period) => {
      const versions = await listScheduleVersions(period.id);
      const summary = createSchedulePeriodSummary(period, versions);
      return summary;
    }),
  );
  return periodSummaries;
}

export default async function SchedulesPage() {
  const periods = await loadSchedulePeriodSummaries();

  return (
    <AppShell>
      <PageHeader
        title="Schedules"
        description="Choose a schedule period, open it in its own workspace, and track publish history over time."
        actionHref="/schedules/new"
        actionLabel="New schedule"
      />
      <section className="rounded-md border border-slate-200 bg-white">
        <div className="hidden grid-cols-[minmax(0,1.2fr)_minmax(10rem,0.7fr)_minmax(9rem,0.6fr)_auto] border-b border-slate-200 px-4 py-3 text-xs font-semibold uppercase text-slate-500 lg:grid">
          <span>Schedule period</span>
          <span>Status</span>
          <span>Last publish</span>
          <span className="text-right">Action</span>
        </div>
        <div className="divide-y divide-slate-200">
          {periods.length === 0 ? (
            <div className="px-4 py-8 text-sm text-slate-500">
              No schedule periods have been created yet.
            </div>
          ) : null}
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
                      {period.unpublishedChangeCount} draft versions
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
