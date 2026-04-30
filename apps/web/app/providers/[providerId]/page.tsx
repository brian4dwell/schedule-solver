import { PageHeader } from "@/components/layout/page-header";
import { AppShell } from "@/components/layout/app-shell";
import { ProviderForm } from "@/components/providers/provider-form";
import { getProvider, listCenters, listRoomTypes } from "@/lib/api";

type ProviderDetailPageProps = {
  params: Promise<{
    providerId: string;
  }>;
};

export default async function ProviderDetailPage({ params }: ProviderDetailPageProps) {
  const resolvedParams = await params;
  const provider = await getProvider(resolvedParams.providerId);
  const centers = await listCenters();
  const roomTypes = await listRoomTypes();

  return (
    <AppShell>
      <PageHeader
        title={provider.display_name}
        description="Edit provider details used for scheduling coverage."
      />
      <ProviderForm centers={centers} provider={provider} roomTypes={roomTypes} />
    </AppShell>
  );
}
