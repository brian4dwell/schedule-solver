import { auth } from "@clerk/nextjs/server";

import { PageHeader } from "@/components/layout/page-header";
import { AppShell } from "@/components/layout/app-shell";
import { ProviderForm } from "@/components/providers/provider-form";
import { listCenters, listRoomTypes } from "@/lib/api";

export default async function NewProviderPage() {
  await auth.protect();

  const centers = await listCenters();
  const roomTypes = await listRoomTypes();

  return (
    <AppShell>
      <PageHeader
        title="Add provider"
        description="Create a provider record for future scheduling coverage."
      />
      <ProviderForm centers={centers} roomTypes={roomTypes} />
    </AppShell>
  );
}
