"use client";

import { Fragment, useState, type KeyboardEvent } from "react";

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

function formatDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  const formatter = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  });
  const formattedDate = formatter.format(date);
  return formattedDate;
}

function formatWeekRange(startDate: string, endDate: string) {
  const formattedStartDate = formatDate(startDate);
  const formattedEndDate = formatDate(endDate);
  const range = `${formattedStartDate} - ${formattedEndDate}`;
  return range;
}

function formatUnsetWeekdays(weekdays: string[]) {
  const weekdayLabels = weekdays.map((weekday) => {
    const label = weekday.charAt(0).toUpperCase() + weekday.slice(1);
    return label;
  });
  const text = weekdayLabels.join(", ");
  return text;
}

export function AvailabilitySubmissionMonitorTable({
  statuses,
}: AvailabilitySubmissionMonitorTableProps) {
  const [expandedProviderId, setExpandedProviderId] = useState<string | null>(null);

  function toggleProvider(providerId: string, hasIncompleteWeeks: boolean) {
    if (!hasIncompleteWeeks) {
      return;
    }

    setExpandedProviderId((currentProviderId) => {
      const providerIsExpanded = currentProviderId === providerId;
      const nextProviderId = providerIsExpanded ? null : providerId;
      return nextProviderId;
    });
  }

  function handleRowKeyDown(
    event: KeyboardEvent<HTMLTableRowElement>,
    providerId: string,
    hasIncompleteWeeks: boolean,
  ) {
    const keyIsEnter = event.key === "Enter";
    const keyIsSpace = event.key === " ";
    const keyActivatesRow = keyIsEnter || keyIsSpace;

    if (!keyActivatesRow) {
      return;
    }

    event.preventDefault();
    toggleProvider(providerId, hasIncompleteWeeks);
  }

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
              const hasIncompleteWeeks = status.incompleteOpenRequiredWeeks.length > 0;
              const providerIsExpanded = expandedProviderId === status.providerId;
              const rowIsInteractive = hasIncompleteWeeks;
              const rowClass = rowIsInteractive
                ? "cursor-pointer hover:bg-slate-50"
                : "";

              return (
                <Fragment key={status.providerId}>
                  <tr
                    aria-expanded={rowIsInteractive ? providerIsExpanded : undefined}
                    className={rowClass}
                    onClick={() => toggleProvider(status.providerId, hasIncompleteWeeks)}
                    onKeyDown={(event) => {
                      handleRowKeyDown(event, status.providerId, hasIncompleteWeeks);
                    }}
                    role={rowIsInteractive ? "button" : undefined}
                    tabIndex={rowIsInteractive ? 0 : undefined}
                  >
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
                  {providerIsExpanded ? (
                    <tr>
                      <td className="bg-slate-50 px-4 py-3" colSpan={6}>
                        <div className="grid gap-2">
                          {status.incompleteOpenRequiredWeeks.map((week) => {
                            const weekRange = formatWeekRange(
                              week.scheduleWeekStartDate,
                              week.scheduleWeekEndDate,
                            );
                            const unsetWeekdays = formatUnsetWeekdays(week.unsetWeekdays);

                            return (
                              <div
                                key={week.scheduleWeekId}
                                className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2"
                              >
                                <div className="text-sm font-semibold text-slate-950">
                                  {week.scheduleWeekName}
                                </div>
                                <div className="mt-1 text-xs text-slate-600">{weekRange}</div>
                                <div className="mt-1 text-xs font-medium text-amber-900">
                                  Unset weekdays: {unsetWeekdays}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
