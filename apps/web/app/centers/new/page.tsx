import { auth } from "@clerk/nextjs/server";

import { CenterForm } from "@/components/centers/center-form";
import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";

export default async function NewCenterPage() {
  await auth.protect();

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
