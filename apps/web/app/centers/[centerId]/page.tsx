import { CenterForm } from "@/components/centers/center-form";
import { PageHeader } from "@/components/layout/page-header";
import { AppShell } from "@/components/layout/app-shell";
import { RoomForm } from "@/components/rooms/room-form";
import { RoomsTable } from "@/components/rooms/rooms-table";
import { getCenter, listCenters, listRoomsForCenter } from "@/lib/api";

type CenterDetailPageProps = {
  params: Promise<{
    centerId: string;
  }>;
};

export default async function CenterDetailPage({ params }: CenterDetailPageProps) {
  const resolvedParams = await params;
  const center = await getCenter(resolvedParams.centerId);
  const centers = await listCenters();
  const rooms = await listRoomsForCenter(resolvedParams.centerId);
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
        <RoomForm centers={centers} selectedCenterId={center.id} />
        <RoomsTable rows={rows} />
      </div>
    </AppShell>
  );
}
