import { CenterForm } from "@/components/centers/center-form";
import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";

export default function NewCenterPage() {
  return (
    <AppShell>
      <PageHeader
        title="Add center"
        description="Create a surgery center location for room and coverage setup."
      />
      <CenterForm />
    </AppShell>
  );
}
