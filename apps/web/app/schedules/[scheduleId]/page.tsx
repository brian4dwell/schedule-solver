import { auth } from "@clerk/nextjs/server";

import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { ScheduleWorkspace } from "@/components/schedules/schedule-workspace";
import {
  getSchedulePeriod,
  getScheduleVersion,
  listSchedulePeriods,
  listScheduleStructureTemplates,
  listCenters,
  listProviders,
  listRoomsForCenter,
  listScheduleVersions,
  type PersistedScheduleVersion,
  type SchedulePeriod,
  type ScheduleVersionDetail,
} from "@/lib/api";

type ScheduleDetailPageProps = {
  params: Promise<{
    scheduleId: string;
  }>;
};

function findAdjacentScheduleWeek(
  periods: SchedulePeriod[],
  currentPeriod: SchedulePeriod,
  dayOffset: number,
) {
  const adjacentDate = new Date(`${currentPeriod.start_date}T00:00:00.000Z`);
  const adjacentDay = adjacentDate.getUTCDate() + dayOffset;
  adjacentDate.setUTCDate(adjacentDay);
  const adjacentIsoDate = adjacentDate.toISOString();
  const adjacentStartDate = adjacentIsoDate.slice(0, 10);
  const adjacentPeriod = periods.find((period) => {
    return period.start_date === adjacentStartDate;
  });
  return adjacentPeriod;
}

function shouldSkipEmptyGeneratedVersion(
  version: PersistedScheduleVersion,
  detail: ScheduleVersionDetail,
) {
  const isSolverVersion = version.source === "solver";
  const hasNoAssignments = detail.assignments.length === 0;
  const shouldSkip = isSolverVersion && hasNoAssignments;
  return shouldSkip;
}

async function loadInitialVersionDetail(
  versions: PersistedScheduleVersion[],
) {
  for (const version of versions) {
    const detail = await getScheduleVersion(version.id);
    const shouldSkip = shouldSkipEmptyGeneratedVersion(version, detail);

    if (shouldSkip) {
      continue;
    }

    return detail;
  }

  return null;
}

export default async function ScheduleDetailPage({
  params,
}: ScheduleDetailPageProps) {
  await auth.protect();

  const routeParams = await params;
  const scheduleId = routeParams.scheduleId;
  const schedulePeriod = await getSchedulePeriod(scheduleId);
  const schedulePeriods = await listSchedulePeriods();
  const previousWeek = findAdjacentScheduleWeek(schedulePeriods, schedulePeriod, -7);
  const nextWeek = findAdjacentScheduleWeek(schedulePeriods, schedulePeriod, 7);
  const scheduleVersions = await listScheduleVersions(scheduleId);
  const initialVersionDetail = await loadInitialVersionDetail(scheduleVersions);
  const scheduleStructureTemplates = await listScheduleStructureTemplates();
  const centers = await listCenters();
  const providers = await listProviders();
  const roomGroups = await Promise.all(
    centers.map(async (center) => {
      const rooms = await listRoomsForCenter(center.id);
      const rows = rooms.map((room) => {
        return { room, center };
      });
      return rows;
    }),
  );
  const rooms = roomGroups.flat();

  return (
    <AppShell>
      <PageHeader
        title="Schedule Workspace"
        description="Edit one schedule period at a time. Open another schedule in a separate browser tab to compare versions."
      />
      <ScheduleWorkspace
        key={scheduleId}
        initialVersionDetail={initialVersionDetail}
        initialVersions={scheduleVersions}
        initialTemplates={scheduleStructureTemplates}
        schedulePeriod={schedulePeriod}
        previousWeek={previousWeek}
        nextWeek={nextWeek}
        providers={providers}
        rooms={rooms}
        scheduleId={scheduleId}
      />
    </AppShell>
  );
}
