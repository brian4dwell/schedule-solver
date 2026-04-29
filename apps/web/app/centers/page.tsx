import { CentersTable } from "@/components/centers/centers-table";
import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { listCenters } from "@/lib/api";

export default async function CentersPage() {
  const centers = await listCenters();

  return (
    <AppShell>
      <PageHeader
        title="Centers"
        description="Physical surgery center locations used for scheduling coverage."
        actionHref="/centers/new"
        actionLabel="Add center"
      />
      <CentersTable centers={centers} />
    </AppShell>
  );
}
