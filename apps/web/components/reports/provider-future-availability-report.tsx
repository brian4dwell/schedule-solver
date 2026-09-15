"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { useToast } from "@/components/ui/toast-provider";
import { getProviderFutureAvailabilityReport } from "@/lib/api";
import type { AvailabilityOption } from "@/lib/schemas/provider-weekly-availability";
import type {
  FutureAvailabilityWeekApi,
  ProviderFutureAvailabilityReportApi,
  ReportProviderApi,
} from "@/lib/schemas/reports";

type ReportProps = {
  providers: ReportProviderApi[];
};

type ReportState =
  | { status: "loading" }
  | { status: "ready"; report: ProviderFutureAvailabilityReportApi }
  | { status: "error" };

function providerLabel(provider: ReportProviderApi): string {
  const inactiveLabel = provider.is_active ? "" : " · Inactive";
  const label = `${provider.display_name} · ${provider.provider_type} · ${provider.employment_type}${inactiveLabel}`;
  return label;
}

function availabilityLabel(option: AvailabilityOption): string {
  switch (option) {
    case "full_shift":
      return "Full shift";
    case "first_half":
      return "First half";
    case "second_half":
      return "Second half";
    case "short_shift":
      return "Short shift";
    case "none":
      return "None";
    case "unset":
      return "Unset";
  }
}

function completionLabel(week: FutureAvailabilityWeekApi): string {
  if (!week.has_submission) {
    return "Not submitted";
  }

  return week.is_complete ? "Complete" : "Incomplete";
}

function AvailabilityWeek({ week }: { week: FutureAvailabilityWeekApi }) {
  const completion = completionLabel(week);
  const completionClass = week.is_complete ? "text-emerald-800" : "text-amber-800";
  const hasNotes = week.notes !== null;

  return (
    <section className="rounded-md border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-slate-950">{week.name}</h3>
          <p className="mt-1 text-sm text-slate-600">{week.start_date} – {week.end_date}</p>
        </div>
        <div className="flex gap-3 text-sm font-medium">
          <span className="capitalize text-slate-600">{week.status}</span>
          <span className={completionClass}>{completion}</span>
        </div>
      </div>
      <p className="mt-3 text-sm text-slate-700">
        Requested shifts for the entire week: minimum {week.min_shifts_requested}, maximum {week.max_shifts_requested}.
      </p>
      <div className="mt-4 grid gap-5 lg:grid-cols-2">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Availability for {week.name}</caption>
            <thead className="border-b border-slate-200 text-slate-600">
              <tr>
                <th scope="col" className="pb-2 pr-3">Date</th>
                <th scope="col" className="pb-2 pr-3">Weekday</th>
                <th scope="col" className="pb-2">Availability</th>
              </tr>
            </thead>
            <tbody>
              {week.days.map((day) => {
                const optionLabels = day.options.map(availabilityLabel);
                const optionsText = optionLabels.join(", ");

                return (
                  <tr key={day.date} className="border-b border-slate-100 last:border-0">
                    <td className="whitespace-nowrap py-2 pr-3">{day.date}</td>
                    <td className="py-2 pr-3 capitalize">{day.weekday}</td>
                    <td className="py-2">
                      <span>{optionsText}</span>
                      {!day.is_saved ? <span className="ml-2 text-xs text-slate-500">Not submitted</span> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="min-w-0 rounded-md bg-slate-50 p-3">
          <h4 className="text-sm font-semibold text-slate-950">Notes for this week</h4>
          {hasNotes ? (
            <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700 [overflow-wrap:anywhere]">{week.notes}</p>
          ) : (
            <p className="mt-2 text-sm text-slate-500">No notes for this week</p>
          )}
        </div>
      </div>
    </section>
  );
}

function SelectedProviderReport({ providerId }: { providerId: string }) {
  const { showToast } = useToast();
  const [state, setState] = useState<ReportState>({ status: "loading" });
  const [refreshCount, setRefreshCount] = useState(0);
  const isLoading = state.status === "loading";

  useEffect(() => {
    let isCurrent = true;

    async function loadReport() {
      try {
        const report = await getProviderFutureAvailabilityReport(providerId);

        if (isCurrent) {
          setState({ status: "ready", report });
        }
      } catch (error) {
        if (isCurrent) {
          setState({ status: "error" });
          const description = error instanceof Error ? error.message : String(error);
          showToast({ title: "Unable to load Provider availability", description, tone: "error" });
        }
      }
    }

    void loadReport();

    return () => {
      isCurrent = false;
    };
  }, [providerId, refreshCount, showToast]);

  function refreshReport() {
    setState({ status: "loading" });
    setRefreshCount((count) => count + 1);
  }

  return (
    <div className="space-y-4" aria-busy={isLoading}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-600">Read-only report of saved availability and notes.</p>
        <button
          type="button"
          disabled={isLoading}
          onClick={refreshReport}
          className="rounded-md bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
        >
          Refresh
        </button>
      </div>
      {isLoading ? <p role="status" className="text-sm text-slate-600">Loading report...</p> : null}
      {state.status === "error" ? <p role="status" className="text-sm text-slate-600">Report unavailable. Refresh to try again.</p> : null}
      {state.status === "ready" ? (
        <>
          <header>
            <h2 className="text-lg font-semibold">{providerLabel(state.report.provider)}</h2>
            <p className="mt-1 text-sm text-slate-600">
              Today and later: {state.report.cutoff_date} ({state.report.timezone}). {state.report.weeks.length} upcoming schedule weeks.
              Current weeks show only remaining dates; notes and requests cover the full week.
            </p>
          </header>
          {state.report.weeks.length === 0 ? <p className="text-sm text-slate-600">No upcoming schedule weeks</p> : null}
          {state.report.weeks.map((week) => <AvailabilityWeek key={week.schedule_period_id} week={week} />)}
        </>
      ) : null}
    </div>
  );
}

export function ProviderFutureAvailabilityReport({ providers }: ReportProps) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [search, setSearch] = useState("");
  const providerId = searchParams.get("provider_id");
  const normalizedSearch = search.trim().toLowerCase();
  const filteredProviders = providers.filter((provider) => {
    const label = providerLabel(provider);
    const normalizedLabel = label.toLowerCase();
    const matchesSearch = normalizedLabel.includes(normalizedSearch);
    const isSelected = provider.id === providerId;
    return matchesSearch || isSelected;
  });
  const hasSelection = providerId !== null && providerId !== "";
  const selectionIsListed = providers.some((provider) => provider.id === providerId);

  function selectProvider(value: string) {
    const params = new URLSearchParams(searchParams.toString());

    if (value === "") {
      params.delete("provider_id");
    } else {
      params.set("provider_id", value);
    }

    const query = params.toString();
    const url = query === "" ? pathname : `${pathname}?${query}`;
    window.history.pushState(null, "", url);
  }

  return (
    <div className="space-y-5">
      <section className="grid gap-4 rounded-md border border-slate-200 bg-white p-4 sm:grid-cols-2">
        <label className="space-y-2 text-sm font-medium">
          <span className="block">Search Providers</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name, type, or employment"
            className="w-full rounded-md border border-slate-300 px-3 py-2"
          />
        </label>
        <label className="space-y-2 text-sm font-medium">
          <span className="block">Provider</span>
          <select
            value={providerId ?? ""}
            onChange={(event) => selectProvider(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2"
          >
            <option value="">Select a Provider</option>
            {hasSelection && !selectionIsListed ? <option value={providerId}>Unavailable Provider</option> : null}
            {filteredProviders.map((provider) => <option key={provider.id} value={provider.id}>{providerLabel(provider)}</option>)}
          </select>
        </label>
        {filteredProviders.length === 0 ? <p className="text-sm text-slate-500">No matching Providers</p> : null}
      </section>
      {hasSelection ? (
        <SelectedProviderReport key={providerId} providerId={providerId} />
      ) : (
        <p className="text-sm text-slate-600">Select a Provider to view future availability and weekly notes.</p>
      )}
    </div>
  );
}
