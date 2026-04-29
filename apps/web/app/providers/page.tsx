import { PageHeader } from "@/components/layout/page-header";
import { AppShell } from "@/components/layout/app-shell";
import { ProvidersTable } from "@/components/providers/providers-table";
import { listProviders } from "@/lib/api";

export default async function ProvidersPage() {
  const providers = await listProviders();

  return (
    <AppShell>
      <PageHeader
        title="Providers"
        description="People who can be scheduled for surgery center coverage."
        actionHref="/providers/new"
        actionLabel="Add provider"
      />
      <ProvidersTable providers={providers} />
    </AppShell>
  );
}
