import { auth } from "@clerk/nextjs/server";

import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { SchedulePeriodForm } from "@/components/schedules/schedule-period-form";

export default async function NewSchedulePage() {
  await auth.protect();

  return (
    <AppShell>
      <PageHeader
        title="New schedule"
        description="Create a schedule period before adding room slots and Provider assignments."
      />
      <SchedulePeriodForm />
    </AppShell>
  );
}
