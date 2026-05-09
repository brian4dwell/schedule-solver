import { FairnessDashboard } from "@/components/fairness/fairness-dashboard";
import { getFairnessReport } from "@/lib/api";

export default async function FairnessPage() {
  const report = await getFairnessReport();
  return <FairnessDashboard report={report} />;
}
