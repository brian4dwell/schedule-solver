import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";

type FairnessStatus = "Healthy" | "Watch" | "Action Required";

type FairnessMetric = {
  id: string;
  label: string;
  value: string;
  status: FairnessStatus;
  detail: string;
};

type TimelineEvent = {
  id: string;
  title: string;
  time: string;
  actor: string;
  reason: string;
  status: FairnessStatus;
};

const fairnessMetrics: FairnessMetric[] = [
  {
    id: "balance-index",
    label: "Balance Index",
    value: "94%",
    status: "Healthy",
    detail: "Assigned case mix stayed within the weekly fairness target band.",
  },
  {
    id: "overnight-load",
    label: "Overnight Load",
    value: "72%",
    status: "Watch",
    detail: "Two providers absorbed extra overnight calls in the last two cycles.",
  },
  {
    id: "weekend-rotation",
    label: "Weekend Rotation",
    value: "61%",
    status: "Action Required",
    detail: "Rotation fairness dropped after high-acuity weekend add-ons.",
  },
];

const timelineEvents: TimelineEvent[] = [
  {
    id: "txn-201",
    title: "Call redistribution approved",
    time: "2026-05-03 09:14 UTC",
    actor: "Scheduling Supervisor",
    reason: "Provider requested relief after exceeding call intensity threshold.",
    status: "Healthy",
  },
  {
    id: "txn-198",
    title: "Weekend assignment override",
    time: "2026-05-02 18:02 UTC",
    actor: "Coverage Lead",
    reason: "Emergency trauma block required a credentialed responder on short notice.",
    status: "Action Required",
  },
  {
    id: "txn-193",
    title: "Post-op room swap",
    time: "2026-05-02 11:47 UTC",
    actor: "Charge Nurse",
    reason: "Room staffing imbalance corrected to recover equal room exposure.",
    status: "Watch",
  },
];

const statusColorMap: Record<FairnessStatus, string> = {
  Healthy: "bg-emerald-100 text-emerald-800",
  Watch: "bg-amber-100 text-amber-800",
  "Action Required": "bg-rose-100 text-rose-800",
};

function getStatusClassName(status: FairnessStatus): string {
  const className = statusColorMap[status];
  return className;
}

export function FairnessDashboard() {
  return (
    <AppShell>
      <PageHeader
        title="Fairness Dashboard"
        description="Monitor fairness status, timeline activity, and transaction reasons in one place."
      />
      <section className="grid gap-4 md:grid-cols-3">
        {fairnessMetrics.map((metric) => {
          const badgeClassName = getStatusClassName(metric.status);
          return (
            <article key={metric.id} className="rounded-md border border-slate-200 bg-white p-5">
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{metric.label}</h2>
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${badgeClassName}`}>
                  {metric.status}
                </span>
              </div>
              <p className="mt-4 text-3xl font-semibold text-slate-950">{metric.value}</p>
              <p className="mt-3 text-sm leading-6 text-slate-600">{metric.detail}</p>
            </article>
          );
        })}
      </section>
      <section className="mt-6 rounded-md border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-semibold text-slate-950">Timeline & Transaction Reasons</h2>
        <p className="mt-1 text-sm text-slate-600">
          Review fairness-impacting events with explicit status and rationale.
        </p>
        <ol className="mt-5 space-y-4">
          {timelineEvents.map((event) => {
            const badgeClassName = getStatusClassName(event.status);
            return (
              <li key={event.id} className="rounded-md border border-slate-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-base font-semibold text-slate-900">{event.title}</h3>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${badgeClassName}`}>
                    {event.status}
                  </span>
                </div>
                <p className="mt-2 text-xs uppercase tracking-wide text-slate-500">{event.time}</p>
                <p className="mt-2 text-sm text-slate-700">
                  <span className="font-semibold text-slate-900">Actor:</span> {event.actor}
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-700">
                  <span className="font-semibold text-slate-900">Reason:</span> {event.reason}
                </p>
              </li>
            );
          })}
        </ol>
      </section>
    </AppShell>
  );
}
