import { PageHeader } from "@/components/layout/page-header";
import { AppShell } from "@/components/layout/app-shell";
import { ProviderForm } from "@/components/providers/provider-form";
import { ProviderPreferencesEditor } from "@/components/providers/provider-preferences-editor";
import {
  getManagerProviderPreferences,
  getProvider,
  getProviderPreferences,
  listCenters,
  listRoomTypes,
  type ManagerProviderPreferences,
  type ProviderPreferences,
} from "@/lib/api";

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
  const providerIsActive = provider.is_active;
  let preferences: ProviderPreferences | null = null;
  let managerPreferences: ManagerProviderPreferences | null = null;

  if (providerIsActive) {
    preferences = await getProviderPreferences(resolvedParams.providerId);
    managerPreferences = await getManagerProviderPreferences(resolvedParams.providerId);
  }

  return (
    <AppShell>
      <PageHeader
        title={provider.display_name}
        description="Edit provider details used for scheduling coverage."
      />
      <ProviderForm centers={centers} provider={provider} roomTypes={roomTypes} />
      {preferences !== null && managerPreferences !== null ? (
        <ProviderPreferencesEditor
          centers={centers}
          managerPreferences={managerPreferences}
          preferences={preferences}
          provider={provider}
        />
      ) : null}
    </AppShell>
  );
}
