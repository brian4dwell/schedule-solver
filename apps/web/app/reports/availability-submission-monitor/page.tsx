import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { AvailabilitySubmissionMonitorTable } from "@/components/providers/availability-submission-monitor-table";
import { listAdminProviderStatuses } from "@/lib/api";

export default async function AvailabilitySubmissionMonitorPage() {
  const statuses = await listAdminProviderStatuses();

  return (
    <AppShell>
      <PageHeader
        title="Availability Submission Monitor"
        description="Review who has and has not submitted open-week availability."
      />
      <AvailabilitySubmissionMonitorTable statuses={statuses} />
    </AppShell>
  );
}
