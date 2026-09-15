import { auth } from "@clerk/nextjs/server";
import { Suspense } from "react";

import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { ProviderFutureAvailabilityReport } from "@/components/reports/provider-future-availability-report";
import { listFutureAvailabilityProviders } from "@/lib/api";

export default async function ProviderFutureAvailabilityPage() {
  await auth.protect();

  const providers = await listFutureAvailabilityProviders();

  return (
    <AppShell>
      <PageHeader
        title="Provider Future Availability"
        description="Review saved availability, shift requests, and weekly notes for all upcoming schedule weeks."
      />
      <Suspense fallback={<p role="status">Loading report...</p>}>
        <ProviderFutureAvailabilityReport providers={providers} />
      </Suspense>
    </AppShell>
  );
}
