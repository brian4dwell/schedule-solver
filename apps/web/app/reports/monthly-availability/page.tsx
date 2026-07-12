import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { MonthlyAvailabilityReport } from "@/components/reports/monthly-availability-report";
import { getMonthlyAvailabilityReport } from "@/lib/api";

function currentMonthSelection() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const selection = { year, month };
  return selection;
}

export default async function MonthlyAvailabilityPage() {
  const selection = currentMonthSelection();
  const report = await getMonthlyAvailabilityReport(selection.year, selection.month);

  return (
    <AppShell>
      <div className="monthly-availability-screen-only">
        <PageHeader
          title="Monthly Availability"
          description="Review Provider availability selections in a calendar view."
        />
      </div>
      <MonthlyAvailabilityReport initialReport={report} />
    </AppShell>
  );
}
