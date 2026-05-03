import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { SchedulesTable } from "@/components/schedules/schedules-table";
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
      <SchedulesTable periods={periods} />
    </AppShell>
  );
}
