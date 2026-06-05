import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { AdminProviderStatusTable } from "@/components/providers/admin-provider-status-table";
import { listAdminProviderStatuses } from "@/lib/api";

export default async function AdminProviderStatusPage() {
  const statuses = await listAdminProviderStatuses();

  return (
    <AppShell>
      <PageHeader
        title="Provider Status"
        description="Review Provider account links and open-week availability completion."
      />
      <AdminProviderStatusTable statuses={statuses} />
    </AppShell>
  );
}
