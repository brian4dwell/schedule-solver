import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { ScheduleWorkspace } from "@/components/schedules/schedule-workspace";
import { listCenters, listProviders, listRoomsForCenter } from "@/lib/api";

type ScheduleDetailPageProps = {
  params: Promise<{
    scheduleId: string;
  }>;
};

export default async function ScheduleDetailPage({
  params,
}: ScheduleDetailPageProps) {
  const routeParams = await params;
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
        providers={providers}
        rooms={rooms}
        scheduleId={routeParams.scheduleId}
      />
    </AppShell>
  );
}
