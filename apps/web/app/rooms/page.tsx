import { PageHeader } from "@/components/layout/page-header";
import { AppShell } from "@/components/layout/app-shell";
import { RoomForm } from "@/components/rooms/room-form";
import { RoomsTable } from "@/components/rooms/rooms-table";
import { listCenters, listRoomsForCenter, listRoomTypes } from "@/lib/api";

export default async function RoomsPage() {
  const centersPromise = listCenters();
  const roomTypesPromise = listRoomTypes();
  const pageData = await Promise.all([centersPromise, roomTypesPromise]);
  const centers = pageData[0];
  const roomTypes = pageData[1];
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
        <RoomsTable rows={rows} roomTypes={roomTypes} />
        <RoomForm centers={centers} roomTypes={roomTypes} />
      </div>
    </AppShell>
  );
}
