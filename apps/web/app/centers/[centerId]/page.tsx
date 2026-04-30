import { CenterForm } from "@/components/centers/center-form";
import { PageHeader } from "@/components/layout/page-header";
import { AppShell } from "@/components/layout/app-shell";
import { RoomForm } from "@/components/rooms/room-form";
import { RoomsTable } from "@/components/rooms/rooms-table";
import { getCenter, listCenters, listRoomsForCenter, listRoomTypes } from "@/lib/api";

type CenterDetailPageProps = {
  params: Promise<{
    centerId: string;
  }>;
};

export default async function CenterDetailPage({ params }: CenterDetailPageProps) {
  const resolvedParams = await params;
  const centerId = resolvedParams.centerId;
  const centerPromise = getCenter(centerId);
  const centersPromise = listCenters();
  const roomsPromise = listRoomsForCenter(centerId);
  const roomTypesPromise = listRoomTypes();
  const pageData = await Promise.all([
    centerPromise,
    centersPromise,
    roomsPromise,
    roomTypesPromise,
  ]);
  const center = pageData[0];
  const centers = pageData[1];
  const rooms = pageData[2];
  const roomTypes = pageData[3];
  const rows = rooms.map((room) => {
    return { room, center };
  });

  return (
    <AppShell>
      <PageHeader
        title={center.name}
        description="Edit center details and manage rooms inside this location."
      />
      <div className="space-y-6">
        <CenterForm center={center} />
        <RoomsTable rows={rows} roomTypes={roomTypes} />
        <RoomForm
          centers={centers}
          roomTypes={roomTypes}
          selectedCenterId={center.id}
        />
      </div>
    </AppShell>
  );
}
