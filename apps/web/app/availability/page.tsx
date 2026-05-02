import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { ProviderAvailabilityEditor } from "@/components/providers/provider-availability-editor";
import { listProviders, listSchedulePeriods } from "@/lib/api";

export default async function AvailabilityPage() {
  const periods = await listSchedulePeriods();
  const providers = await listProviders();

  return (
    <AppShell>
      <PageHeader
        title="Availability"
        description="Select a schedule week and provider, then save that week’s availability choices."
      />
      <ProviderAvailabilityEditor periods={periods} providers={providers} />
    </AppShell>
  );
}
