import { PageHeader } from "@/components/layout/page-header";
import { AppShell } from "@/components/layout/app-shell";
import { RoomForm } from "@/components/rooms/room-form";
import { RoomsTable } from "@/components/rooms/rooms-table";
import { listCenters, listRoomsForCenter } from "@/lib/api";

export default async function RoomsPage() {
  const centers = await listCenters();
  const roomGroups = await Promise.all(
    centers.map(async (center) => {
      const rooms = await listRoomsForCenter(center.id);
      const rows = rooms.map((room) => {
        return { room, center };
      });
      return rows;
    }),
  );
  const rows = roomGroups.flat();

  return (
    <AppShell>
      <PageHeader
        title="Rooms"
        description="Rooms belong to centers and become the scheduling coverage targets."
      />
      <div className="space-y-6">
        <RoomForm centers={centers} />
        <RoomsTable rows={rows} />
      </div>
    </AppShell>
  );
}
