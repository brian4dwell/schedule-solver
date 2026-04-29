import { PageHeader } from "@/components/layout/page-header";
import { AppShell } from "@/components/layout/app-shell";
import { ProviderForm } from "@/components/providers/provider-form";

export default function NewProviderPage() {
  return (
    <AppShell>
      <PageHeader
        title="Add provider"
        description="Create a provider record for future scheduling coverage."
      />
      <ProviderForm />
    </AppShell>
  );
}
