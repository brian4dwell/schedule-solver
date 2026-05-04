"use client";

import { useMemo, useState } from "react";

import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import type { FairnessReport, FairnessStatus } from "@/lib/api";

type FairnessDashboardProps = {
  report: FairnessReport;
};

type FairnessSnapshot = FairnessReport["snapshots"][number];

type FairnessEvent = FairnessReport["events"][number];

type EventScope = "all" | "debt" | "favor";

type ProviderSortKey = "pressure" | "debt" | "assignments";

function statusClassName(status: FairnessStatus): string {
  if (status === "Action Required") {
    return "bg-rose-100 text-rose-800";
  }

  if (status === "Watch") {
    return "bg-amber-100 text-amber-800";
  }

  return "bg-emerald-100 text-emerald-800";
}

function selectedButtonClassName(isSelected: boolean): string {
  if (isSelected) {
    return "border-slate-950 bg-slate-950 text-white";
  }

  return "border-slate-300 bg-white text-slate-700 hover:border-slate-500";
}

function formatNumber(value: number): string {
  const formattedValue = value.toFixed(1);
  return formattedValue;
}

function formatSignedNumber(value: number): string {
  const sign = value >= 0 ? "+" : "";
  const formattedValue = `${sign}${value.toFixed(1)}`;
  return formattedValue;
}

function formatDate(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  const formattedValue = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
  return formattedValue;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  const formattedValue = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
  return formattedValue;
}

function humanizeToken(value: string): string {
  const spacedValue = value.replaceAll("_", " ");
  const titleValue = spacedValue.replace(/\b\w/g, (letter) => {
    const upperLetter = letter.toUpperCase();
    return upperLetter;
  });
  return titleValue;
}

function reportTitle(report: FairnessReport): string {
  if (report.schedule_period === null) {
    return "No schedule version";
  }

  const version = report.schedule_version;

  if (version === null) {
    return report.schedule_period.name;
  }

  const title = `${report.schedule_period.name} - Version ${version.version_number}`;
  return title;
}

function reportDateRange(report: FairnessReport): string {
  if (report.schedule_period === null) {
    return "";
  }

  const startDate = formatDate(report.schedule_period.start_date);
  const endDate = formatDate(report.schedule_period.end_date);
  const range = `${startDate} to ${endDate}`;
  return range;
}

function pressureStatus(snapshot: FairnessSnapshot): FairnessStatus {
  if (snapshot.fairness_pressure >= 8) {
    return "Action Required";
  }

  if (snapshot.fairness_pressure >= 4) {
    return "Watch";
  }

  return "Healthy";
}

function pressureBarWidth(snapshot: FairnessSnapshot, maxPressure: number): string {
  if (maxPressure <= 0) {
    return "0%";
  }

  const ratio = snapshot.fairness_pressure / maxPressure;
  const boundedRatio = Math.min(Math.max(ratio, 0), 1);
  const percent = boundedRatio * 100;
  const width = `${percent.toFixed(0)}%`;
  return width;
}

function sortedSnapshots(
  snapshots: FairnessSnapshot[],
  sortKey: ProviderSortKey,
): FairnessSnapshot[] {
  const nextSnapshots = [...snapshots];
  nextSnapshots.sort((firstSnapshot, secondSnapshot) => {
    if (sortKey === "debt") {
      return secondSnapshot.ending_debt - firstSnapshot.ending_debt;
    }

    if (sortKey === "assignments") {
      return secondSnapshot.assignment_count - firstSnapshot.assignment_count;
    }

    return secondSnapshot.fairness_pressure - firstSnapshot.fairness_pressure;
  });
  return nextSnapshots;
}

function eventMatchesScope(event: FairnessEvent, eventScope: EventScope): boolean {
  if (eventScope === "debt") {
    return event.debt_delta > 0;
  }

  if (eventScope === "favor") {
    return event.favor_delta > 0;
  }

  return true;
}

function filteredEvents(
  events: FairnessEvent[],
  providerId: string | null,
  eventScope: EventScope,
): FairnessEvent[] {
  const matchingEvents = events.filter((event) => {
    const providerMatches = providerId === null || event.provider_id === providerId;
    const scopeMatches = eventMatchesScope(event, eventScope);
    const matches = providerMatches && scopeMatches;
    return matches;
  });
  return matchingEvents;
}

function highestPressureSnapshot(snapshots: FairnessSnapshot[]): FairnessSnapshot | null {
  if (snapshots.length === 0) {
    return null;
  }

  const sortedByPressure = sortedSnapshots(snapshots, "pressure");
  const firstSnapshot = sortedByPressure[0];
  return firstSnapshot;
}

function totalDebtDelta(events: FairnessEvent[]): number {
  const total = events.reduce((currentTotal, event) => {
    const nextTotal = currentTotal + event.debt_delta;
    return nextTotal;
  }, 0);
  return total;
}

function totalFavorDelta(events: FairnessEvent[]): number {
  const total = events.reduce((currentTotal, event) => {
    const nextTotal = currentTotal + event.favor_delta;
    return nextTotal;
  }, 0);
  return total;
}

function emptyState() {
  return (
    <section className="rounded-md border border-slate-200 bg-white p-6">
      <h2 className="text-lg font-semibold text-slate-950">No Fairness Report Yet</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        Generate or save a schedule version to create fairness snapshots and event records.
      </p>
    </section>
  );
}

export function FairnessDashboard({ report }: FairnessDashboardProps) {
  const [eventScope, setEventScope] = useState<EventScope>("all");
  const [sortKey, setSortKey] = useState<ProviderSortKey>("pressure");
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const sortedProviderSnapshots = useMemo(() => {
    const snapshots = sortedSnapshots(report.snapshots, sortKey);
    return snapshots;
  }, [report.snapshots, sortKey]);
  const selectedProvider = useMemo(() => {
    if (selectedProviderId === null) {
      return highestPressureSnapshot(report.snapshots);
    }

    const snapshot = report.snapshots.find((providerSnapshot) => {
      const providerMatches = providerSnapshot.provider_id === selectedProviderId;
      return providerMatches;
    });

    if (snapshot === undefined) {
      return highestPressureSnapshot(report.snapshots);
    }

    return snapshot;
  }, [report.snapshots, selectedProviderId]);
  const selectedProviderEvents = useMemo(() => {
    const providerId = selectedProvider?.provider_id ?? null;
    const events = filteredEvents(report.events, providerId, eventScope);
    return events;
  }, [report.events, selectedProvider, eventScope]);
  const ledgerEvents = useMemo(() => {
    const events = filteredEvents(report.events, null, eventScope);
    return events;
  }, [report.events, eventScope]);
  const maxPressure = useMemo(() => {
    const pressures = report.snapshots.map((snapshot) => {
      return snapshot.fairness_pressure;
    });
    const maxValue = Math.max(0, ...pressures);
    return maxValue;
  }, [report.snapshots]);
  return (
    <AppShell>
      <PageHeader
        title="Fairness Dashboard"
        description="Review persisted fairness balances, event ledger entries, and schedule-run pressure."
      />
      {!report.has_data ? (
        emptyState()
      ) : (
        <div className="space-y-6">
          <section className="rounded-md border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">{reportTitle(report)}</h2>
                <p className="mt-1 text-sm text-slate-600">{reportDateRange(report)}</p>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div>
                  <p className="text-xs font-semibold uppercase text-slate-500">Providers</p>
                  <p className="mt-1 text-lg font-semibold text-slate-950">{report.snapshots.length}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase text-slate-500">Events</p>
                  <p className="mt-1 text-lg font-semibold text-slate-950">{report.events.length}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase text-slate-500">Decay</p>
                  <p className="mt-1 text-lg font-semibold text-slate-950">
                    {report.config?.decay_factor.toFixed(2)}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase text-slate-500">Config</p>
                  <p className="mt-1 text-lg font-semibold text-slate-950">
                    v{report.config?.version_number}
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-3">
            {report.metrics.map((metric) => {
              const badgeClassName = statusClassName(metric.status);
              return (
                <article key={metric.id} className="rounded-md border border-slate-200 bg-white p-5">
                  <div className="flex min-h-8 items-start justify-between gap-3">
                    <h2 className="text-sm font-semibold uppercase text-slate-500">{metric.label}</h2>
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

          <section className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
            <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-5">
                <h2 className="text-lg font-semibold text-slate-950">Provider Pressure</h2>
                <div className="flex flex-wrap gap-2">
                  {(["pressure", "debt", "assignments"] as ProviderSortKey[]).map((key) => {
                    const selected = sortKey === key;
                    const className = selectedButtonClassName(selected);
                    return (
                      <button
                        key={key}
                        className={`rounded-md border px-3 py-1.5 text-sm font-semibold ${className}`}
                        type="button"
                        onClick={() => setSortKey(key)}
                      >
                        {humanizeToken(key)}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="divide-y divide-slate-200">
                {sortedProviderSnapshots.map((snapshot) => {
                  const selected = selectedProvider?.provider_id === snapshot.provider_id;
                  const status = pressureStatus(snapshot);
                  const badgeClassName = statusClassName(status);
                  const barWidth = pressureBarWidth(snapshot, maxPressure);
                  const rowClassName = selected ? "bg-slate-50" : "bg-white";
                  return (
                    <button
                      key={snapshot.id}
                      className={`block w-full p-4 text-left ${rowClassName}`}
                      type="button"
                      onClick={() => setSelectedProviderId(snapshot.provider_id)}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-950">{snapshot.provider_display_name}</p>
                          <p className="mt-1 text-sm text-slate-600">
                            {snapshot.assignment_count} assignments - {snapshot.negative_event_count} debt
                            events - {snapshot.positive_event_count} favor events
                          </p>
                        </div>
                        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${badgeClassName}`}>
                          {formatNumber(snapshot.fairness_pressure)}
                        </span>
                      </div>
                      <div className="mt-3 h-2 rounded-full bg-slate-100">
                        <div className="h-2 rounded-full bg-cyan-700" style={{ width: barWidth }} />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-md border border-slate-200 bg-white p-5">
              {selectedProvider === null ? (
                <div>
                  <h2 className="text-lg font-semibold text-slate-950">Provider Detail</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-600">No provider snapshot is available.</p>
                </div>
              ) : (
                <div>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-semibold text-slate-950">
                        {selectedProvider.provider_display_name}
                      </h2>
                      <p className="mt-1 text-sm text-slate-600">
                        {humanizeToken(selectedProvider.priority_tier)} tier - multiplier{" "}
                        {formatNumber(selectedProvider.priority_multiplier)}
                      </p>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusClassName(pressureStatus(selectedProvider))}`}>
                      {pressureStatus(selectedProvider)}
                    </span>
                  </div>
                  <dl className="mt-5 grid grid-cols-2 gap-4">
                    <div>
                      <dt className="text-xs font-semibold uppercase text-slate-500">Starting Debt</dt>
                      <dd className="mt-1 text-xl font-semibold text-slate-950">
                        {formatNumber(selectedProvider.starting_debt)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold uppercase text-slate-500">Ending Debt</dt>
                      <dd className="mt-1 text-xl font-semibold text-slate-950">
                        {formatNumber(selectedProvider.ending_debt)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold uppercase text-slate-500">Starting Favor</dt>
                      <dd className="mt-1 text-xl font-semibold text-slate-950">
                        {formatNumber(selectedProvider.starting_favor_credit)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold uppercase text-slate-500">Ending Favor</dt>
                      <dd className="mt-1 text-xl font-semibold text-slate-950">
                        {formatNumber(selectedProvider.ending_favor_credit)}
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-5 rounded-md bg-slate-50 p-4">
                    <p className="text-xs font-semibold uppercase text-slate-500">This Version</p>
                    <p className="mt-2 text-sm text-slate-700">
                      {formatSignedNumber(selectedProvider.weekly_debt_delta)} debt /{" "}
                      {formatSignedNumber(selectedProvider.weekly_favor_delta)} favor
                    </p>
                    <p className="mt-1 text-sm text-slate-700">
                      Visible events after filter: {selectedProviderEvents.length}
                    </p>
                  </div>
                  <div className="mt-5 flex flex-wrap gap-2">
                    {(["all", "debt", "favor"] as EventScope[]).map((scope) => {
                      const selected = eventScope === scope;
                      const className = selectedButtonClassName(selected);
                      return (
                        <button
                          key={scope}
                          className={`rounded-md border px-3 py-1.5 text-sm font-semibold ${className}`}
                          type="button"
                          onClick={() => setEventScope(scope)}
                        >
                          {humanizeToken(scope)}
                        </button>
                      );
                    })}
                  </div>
                  <ol className="mt-5 space-y-3">
                    {selectedProviderEvents.map((event) => {
                      return (
                        <li key={event.id} className="border-l-2 border-cyan-700 pl-4">
                          <p className="font-semibold text-slate-950">{humanizeToken(event.event_type)}</p>
                          <p className="mt-1 text-sm leading-6 text-slate-700">{event.reason}</p>
                          <p className="mt-1 text-xs text-slate-500">{formatDateTime(event.occurred_at)}</p>
                        </li>
                      );
                    })}
                  </ol>
                  {selectedProviderEvents.length === 0 ? (
                    <p className="mt-5 text-sm text-slate-600">No events match the current filter.</p>
                  ) : null}
                </div>
              )}
            </div>
          </section>

          <section className="overflow-hidden rounded-md border border-slate-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-5">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">Event Ledger</h2>
                <p className="mt-1 text-sm text-slate-600">
                  {formatSignedNumber(totalDebtDelta(ledgerEvents))} debt /{" "}
                  {formatSignedNumber(totalFavorDelta(ledgerEvents))} favor
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {(["all", "debt", "favor"] as EventScope[]).map((scope) => {
                  const selected = eventScope === scope;
                  const className = selectedButtonClassName(selected);
                  return (
                    <button
                      key={scope}
                      className={`rounded-md border px-3 py-1.5 text-sm font-semibold ${className}`}
                      type="button"
                      onClick={() => setEventScope(scope)}
                    >
                      {humanizeToken(scope)}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Time</th>
                    <th className="px-4 py-3">Provider</th>
                    <th className="px-4 py-3">Event</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">Debt</th>
                    <th className="px-4 py-3">Favor</th>
                    <th className="px-4 py-3">Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {ledgerEvents.map((event) => {
                    return (
                      <tr key={event.id}>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                          {formatDateTime(event.occurred_at)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-950">
                          {event.provider_display_name}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                          {humanizeToken(event.event_type)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                          {humanizeToken(event.category)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                          {formatSignedNumber(event.debt_delta)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                          {formatSignedNumber(event.favor_delta)}
                        </td>
                        <td className="min-w-80 px-4 py-3 leading-6 text-slate-700">{event.reason}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </AppShell>
  );
}
