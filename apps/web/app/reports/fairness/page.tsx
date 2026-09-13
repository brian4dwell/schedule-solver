import { auth } from "@clerk/nextjs/server";

import { FairnessDashboard } from "@/components/fairness/fairness-dashboard";
import { getFairnessReport } from "@/lib/api";

export default async function FairnessPage() {
  await auth.protect();

  const report = await getFairnessReport();
  return <FairnessDashboard report={report} />;
}
