import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { ProviderInvitesTable } from "@/components/providers/provider-invites-table";
import { listAdminProviderStatuses } from "@/lib/api";

export default async function ProviderInvitesPage() {
  const statuses = await listAdminProviderStatuses();

  return (
    <AppShell>
      <PageHeader
        title="Provider Invites"
        description="Create Provider Portal invite links and send invite emails."
      />
      <ProviderInvitesTable statuses={statuses} />
    </AppShell>
  );
}
