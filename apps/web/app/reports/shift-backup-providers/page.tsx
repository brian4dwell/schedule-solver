import { auth } from "@clerk/nextjs/server";

import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { ShiftBackupProviderReportWorkspace } from "@/components/reports/shift-backup-provider-report";

export default async function ShiftBackupProviderReportPage() {
  await auth.protect();

  return (
    <AppShell>
      <div className="shift-backup-screen-only">
        <PageHeader title="Shift Backup Providers" description="Find potential replacements using current availability and qualifications, then print the selected schedule." />
      </div>
      <ShiftBackupProviderReportWorkspace />
    </AppShell>
  );
}
