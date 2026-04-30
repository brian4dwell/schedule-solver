import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { RoomTypesPanel } from "@/components/rooms/room-types-panel";
import { listRoomTypes } from "@/lib/api";

export default async function RoomTypesPage() {
  const roomTypes = await listRoomTypes();

  return (
    <AppShell>
      <PageHeader
        title="Room Types"
        description="Manage the organization-wide room types used for room assignment and scheduling filters."
      />
      <RoomTypesPanel roomTypes={roomTypes} />
    </AppShell>
  );
}
