import type { AdminProviderStatusRecord } from "@/lib/api";

type AvailabilitySubmissionMonitorTableProps = {
  statuses: AdminProviderStatusRecord[];
};

function availabilityLabel(status: AdminProviderStatusRecord) {
  if (status.openWeekCount === 0) {
    return "No open weeks";
  }

  if (status.openWeekAvailabilityComplete) {
    return "Complete";
  }

  const label = `${status.incompleteOpenRequiredWeekCount} incomplete`;
  return label;
}

function statusToneClass(status: AdminProviderStatusRecord) {
  if (status.openWeekCount === 0) {
    return "bg-slate-100 text-slate-700";
  }

  if (status.openWeekAvailabilityComplete) {
    return "bg-emerald-100 text-emerald-800";
  }

  return "bg-amber-100 text-amber-900";
}

function formatLastUpdate(value: string | null) {
  if (value === null) {
    return "None";
  }

  return value;
}

export function AvailabilitySubmissionMonitorTable({
  statuses,
}: AvailabilitySubmissionMonitorTableProps) {
  return (
    <section className="rounded-md border border-slate-200 bg-white">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-100 text-left text-slate-700">
            <tr>
              <th className="px-4 py-3 font-semibold">Provider</th>
              <th className="px-4 py-3 font-semibold">Email</th>
              <th className="px-4 py-3 font-semibold">Availability</th>
              <th className="px-4 py-3 font-semibold">Open weeks</th>
              <th className="px-4 py-3 font-semibold">Incomplete weeks</th>
              <th className="px-4 py-3 font-semibold">Last update</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {statuses.map((status) => {
              const availabilityClass = statusToneClass(status);
              const lastUpdate = formatLastUpdate(status.lastAvailabilityUpdateAt);

              return (
                <tr key={status.providerId}>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-950">{status.providerName}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{status.providerEmail ?? "No email"}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-md px-2 py-1 text-xs font-semibold ${availabilityClass}`}>
                      {availabilityLabel(status)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{status.openWeekCount}</td>
                  <td className="px-4 py-3 text-slate-700">
                    {status.incompleteOpenRequiredWeekCount}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{lastUpdate}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
