import { PageHeader } from "@/components/layout/page-header";
import { AppShell } from "@/components/layout/app-shell";
import { ProviderForm } from "@/components/providers/provider-form";
import { getProvider } from "@/lib/api";

type ProviderDetailPageProps = {
  params: Promise<{
    providerId: string;
  }>;
};

export default async function ProviderDetailPage({ params }: ProviderDetailPageProps) {
  const resolvedParams = await params;
  const provider = await getProvider(resolvedParams.providerId);

  return (
    <AppShell>
      <PageHeader
        title={provider.display_name}
        description="Edit provider details used for scheduling coverage."
      />
      <ProviderForm provider={provider} />
    </AppShell>
  );
}
