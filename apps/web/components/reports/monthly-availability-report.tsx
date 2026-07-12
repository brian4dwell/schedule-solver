"use client";

import { useEffect, useMemo, useState } from "react";

import {
  getMonthlyAvailabilityReport,
  type MonthlyAvailabilityReport as MonthlyAvailabilityReportData,
} from "@/lib/api";
import type {
  MonthlyAvailabilityDayApi,
  MonthlyAvailabilityOption,
  MonthlyAvailabilityProviderApi,
  MonthlyScheduleAssignmentApi,
  MonthlyScheduleCandidateApi,
  MonthlyScheduleCandidateGroupApi,
} from "@/lib/schemas/reports";

type MonthlyAvailabilityReportProps = {
  initialReport: MonthlyAvailabilityReportData;
};

type CalendarEmptyCell = {
  kind: "empty";
  key: string;
};

type CalendarDayCell = {
  kind: "day";
  key: string;
  day: MonthlyAvailabilityDayApi;
};

type CalendarCell = CalendarEmptyCell | CalendarDayCell;

type CalendarColumn = {
  label: string;
  weekdayIndex: number;
};

const monthOptions = [
  { value: 1, label: "January" },
  { value: 2, label: "February" },
  { value: 3, label: "March" },
  { value: 4, label: "April" },
  { value: 5, label: "May" },
  { value: 6, label: "June" },
  { value: 7, label: "July" },
  { value: 8, label: "August" },
  { value: 9, label: "September" },
  { value: 10, label: "October" },
  { value: 11, label: "November" },
  { value: 12, label: "December" },
];

const weekdayColumns: CalendarColumn[] = [
  { label: "Sun", weekdayIndex: 0 },
  { label: "Mon", weekdayIndex: 1 },
  { label: "Tue", weekdayIndex: 2 },
  { label: "Wed", weekdayIndex: 3 },
  { label: "Thu", weekdayIndex: 4 },
  { label: "Fri", weekdayIndex: 5 },
  { label: "Sat", weekdayIndex: 6 },
];

function dateAtUtcMidnight(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  return date;
}

function visibleWeekdayColumns(showWeekends: boolean): CalendarColumn[] {
  if (showWeekends) {
    return weekdayColumns;
  }

  const columns = weekdayColumns.filter((column) => {
    const isWeekend = column.weekdayIndex === 0 || column.weekdayIndex === 6;
    return !isWeekend;
  });
  return columns;
}

function dateIsVisible(value: string, showWeekends: boolean): boolean {
  if (showWeekends) {
    return true;
  }

  const date = dateAtUtcMidnight(value);
  const weekdayIndex = date.getUTCDay();
  const isWeekend = weekdayIndex === 0 || weekdayIndex === 6;
  const isVisible = !isWeekend;
  return isVisible;
}

function leadingEmptyCellCountForDays(
  days: MonthlyAvailabilityDayApi[],
  showWeekends: boolean,
): number {
  const firstDay = days[0];

  if (firstDay === undefined) {
    return 0;
  }

  const firstDate = dateAtUtcMidnight(firstDay.date);
  const weekdayIndex = firstDate.getUTCDay();

  if (showWeekends) {
    return weekdayIndex;
  }

  if (weekdayIndex === 0 || weekdayIndex === 6) {
    return 0;
  }

  const weekdayOffset = weekdayIndex - 1;
  return weekdayOffset;
}

function calendarCells(
  days: MonthlyAvailabilityDayApi[],
  showWeekends: boolean,
): CalendarCell[] {
  const firstDay = days[0];
  const cells: CalendarCell[] = [];

  if (firstDay === undefined) {
    return cells;
  }

  const leadingEmptyCellCount = leadingEmptyCellCountForDays(days, showWeekends);

  for (let index = 0; index < leadingEmptyCellCount; index += 1) {
    const key = `empty-leading-${index}`;
    const cell: CalendarEmptyCell = { kind: "empty", key };
    cells.push(cell);
  }

  days.forEach((day) => {
    const isVisible = dateIsVisible(day.date, showWeekends);

    if (!isVisible) {
      return;
    }

    const key = day.date;
    const cell: CalendarDayCell = { kind: "day", key, day };
    cells.push(cell);
  });

  return cells;
}

function formatDayNumber(value: string): string {
  const date = dateAtUtcMidnight(value);
  const dayNumber = date.getUTCDate();
  const label = dayNumber.toString();
  return label;
}

function formatSelectedMonth(report: MonthlyAvailabilityReportData): string {
  const date = dateAtUtcMidnight(report.start_date);
  const formatter = new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const label = formatter.format(date);
  return label;
}

function optionLabel(option: MonthlyAvailabilityOption): string {
  if (option === "full_shift") {
    return "F";
  }

  if (option === "first_half") {
    return "1st";
  }

  if (option === "second_half") {
    return "2nd";
  }

  return "S";
}

function shiftTypeLabel(option: MonthlyAvailabilityOption): string {
  if (option === "full_shift") {
    return "Full";
  }

  if (option === "first_half") {
    return "1st half";
  }

  if (option === "second_half") {
    return "2nd half";
  }

  return "Short";
}

function providerIsScheduled(provider: MonthlyAvailabilityProviderApi): boolean {
  const isScheduled = provider.scheduled_assignments.length > 0;
  return isScheduled;
}

function optionToneClassName(option: MonthlyAvailabilityOption): string {
  if (option === "full_shift") {
    return "bg-emerald-100 text-emerald-900";
  }

  if (option === "first_half") {
    return "bg-sky-100 text-sky-900";
  }

  if (option === "second_half") {
    return "bg-amber-100 text-amber-900";
  }

  return "bg-rose-100 text-rose-900";
}

function statusLabel(value: string): string {
  const normalizedValue = value.replaceAll("_", " ");
  const label = normalizedValue.charAt(0).toUpperCase() + normalizedValue.slice(1);
  return label;
}

function formatShortDate(value: string): string {
  const date = dateAtUtcMidnight(value);
  const formatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const label = formatter.format(date);
  return label;
}

function formatTime(value: string): string {
  const date = new Date(value);
  const formatter = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  const label = formatter.format(date);
  return label;
}

function formatScheduleGroupRange(group: MonthlyScheduleCandidateGroupApi): string {
  const startDate = formatShortDate(group.start_date);
  const endDate = formatShortDate(group.end_date);
  const label = `${startDate} - ${endDate}`;
  return label;
}

function candidateLabel(candidate: MonthlyScheduleCandidateApi): string {
  const status = statusLabel(candidate.latest_schedule_version_status);
  const label = `${candidate.schedule_period_name} - v${candidate.latest_schedule_version_number} ${status}`;
  return label;
}

function selectedScheduleCandidate(
  group: MonthlyScheduleCandidateGroupApi,
): MonthlyScheduleCandidateApi | undefined {
  const candidate = group.candidates.find((currentCandidate) => {
    const candidateMatches =
      currentCandidate.schedule_period_id === group.selected_schedule_period_id;
    return candidateMatches;
  });
  return candidate;
}

function totalProviderSelections(days: MonthlyAvailabilityDayApi[]): number {
  const total = days.reduce((currentTotal, day) => {
    const nextTotal = currentTotal + day.providers.length;
    return nextTotal;
  }, 0);
  return total;
}

function totalScheduledProviders(days: MonthlyAvailabilityDayApi[]): number {
  const total = days.reduce((currentTotal, day) => {
    const scheduledProviders = day.providers.filter(providerIsScheduled);
    const nextTotal = currentTotal + scheduledProviders.length;
    return nextTotal;
  }, 0);
  return total;
}

function totalUnscheduledProviders(days: MonthlyAvailabilityDayApi[]): number {
  const total = days.reduce((currentTotal, day) => {
    const unscheduledProviders = day.providers.filter((provider) => {
      const isScheduled = providerIsScheduled(provider);
      return !isScheduled;
    });
    const nextTotal = currentTotal + unscheduledProviders.length;
    return nextTotal;
  }, 0);
  return total;
}

function uniqueProviderCount(days: MonthlyAvailabilityDayApi[]): number {
  const providerIds = new Set<string>();

  days.forEach((day) => {
    day.providers.forEach((provider) => {
      providerIds.add(provider.provider_id);
    });
  });

  const count = providerIds.size;
  return count;
}

function selectedSchedulePeriodIdsFromReport(
  report: MonthlyAvailabilityReportData,
): string[] {
  const ids = report.schedule_candidate_groups.map((group) => {
    return group.selected_schedule_period_id;
  });
  return ids;
}

function schedulePeriodIdsMatch(
  firstIds: string[],
  secondIds: string[],
): boolean {
  if (firstIds.length !== secondIds.length) {
    return false;
  }

  const firstSortedIds = [...firstIds].sort();
  const secondSortedIds = [...secondIds].sort();
  const allIdsMatch = firstSortedIds.every((firstId, index) => {
    const secondId = secondSortedIds[index];
    const idMatches = firstId === secondId;
    return idMatches;
  });
  return allIdsMatch;
}

function daysWithProviderSelections(days: MonthlyAvailabilityDayApi[]): number {
  const matchingDays = days.filter((day) => {
    const hasProviders = day.providers.length > 0;
    return hasProviders;
  });
  const count = matchingDays.length;
  return count;
}

function assignmentDetail(assignment: MonthlyScheduleAssignmentApi) {
  const shiftType = shiftTypeLabel(assignment.shift_type);
  const startTime = formatTime(assignment.start_time);
  const endTime = formatTime(assignment.end_time);
  const roomName = assignment.room_name ?? "No room";
  const versionStatus = statusLabel(assignment.schedule_version_status);
  const detail = `${assignment.center_name} / ${roomName} / ${shiftType} / ${startTime}-${endTime} / v${assignment.schedule_version_number} ${versionStatus}`;
  return detail;
}

function providerOptionMarkers(provider: MonthlyAvailabilityProviderApi) {
  return (
    <span className="monthly-availability-option-markers flex flex-wrap gap-1">
      {provider.options.map((option) => {
        const label = optionLabel(option);
        const toneClassName = optionToneClassName(option);
        return (
          <span
            key={option}
            className={`rounded px-1 py-0.5 text-[10px] font-semibold leading-3 ${toneClassName}`}
          >
            {label}
          </span>
        );
      })}
    </span>
  );
}

function calendarDayCell(day: MonthlyAvailabilityDayApi) {
  const dayNumber = formatDayNumber(day.date);
  const hasProviders = day.providers.length > 0;
  const scheduledProviders = day.providers.filter(providerIsScheduled);
  const unscheduledProviders = day.providers.filter((provider) => {
    const isScheduled = providerIsScheduled(provider);
    return !isScheduled;
  });
  const backgroundClassName = hasProviders ? "bg-white" : "bg-slate-50";
  const cellClassName = `monthly-availability-day-cell min-h-72 rounded-md border border-slate-200 p-1.5 ${backgroundClassName}`;

  return (
    <div className={cellClassName}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-slate-950">{dayNumber}</span>
        <span className="text-xs font-medium text-slate-500">
          {day.providers.length}
        </span>
      </div>
      <div className="mt-1.5 space-y-1.5">
        {scheduledProviders.map((provider) => {
          return (
            <div
              key={`${provider.provider_id}-${provider.schedule_period_id}`}
              className="rounded-md border border-teal-200 bg-teal-50 px-1.5 py-1 shadow-sm"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                  <p className="monthly-availability-print-text truncate text-xs font-semibold text-slate-950">
                    {provider.provider_display_name}
                  </p>
                  {providerOptionMarkers(provider)}
                </div>
                <span className="rounded bg-teal-700 px-1 py-0.5 text-[9px] font-semibold leading-3 text-white">
                  Scheduled
                </span>
              </div>
              {provider.scheduled_assignments.map((assignment) => {
                return (
                  <p
                    key={assignment.assignment_id}
                    className="monthly-availability-print-text mt-0.5 truncate text-[11px] font-medium leading-4 text-teal-950"
                  >
                    {assignmentDetail(assignment)}
                  </p>
                );
              })}
            </div>
          );
        })}
        {unscheduledProviders.map((provider) => {
          return (
            <div
              key={`${provider.provider_id}-${provider.schedule_period_id}`}
              className="rounded-md border border-amber-200 bg-amber-50 px-1.5 py-1 shadow-sm"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                  <p className="monthly-availability-print-text truncate text-xs font-semibold text-slate-950">
                    {provider.provider_display_name}
                  </p>
                  {providerOptionMarkers(provider)}
                </div>
                <span className="rounded bg-amber-200 px-1 py-0.5 text-[9px] font-semibold leading-3 text-amber-950">
                  Available
                </span>
              </div>
            </div>
          );
        })}
        {!hasProviders ? (
          <p className="text-xs font-medium text-slate-400">No providers</p>
        ) : null}
      </div>
    </div>
  );
}

export function MonthlyAvailabilityReport({
  initialReport,
}: MonthlyAvailabilityReportProps) {
  const [selectedMonth, setSelectedMonth] = useState(initialReport.month);
  const [selectedYear, setSelectedYear] = useState(initialReport.year);
  const [showWeekends, setShowWeekends] = useState(false);
  const [selectedSchedulePeriodIds, setSelectedSchedulePeriodIds] = useState(
    () => selectedSchedulePeriodIdsFromReport(initialReport),
  );
  const [report, setReport] = useState(initialReport);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const selectedSchedulePeriodIdKey = selectedSchedulePeriodIds.join(",");
  const cells = useMemo(() => {
    const nextCells = calendarCells(report.days, showWeekends);
    return nextCells;
  }, [report.days, showWeekends]);
  const visibleColumns = useMemo(() => {
    const columns = visibleWeekdayColumns(showWeekends);
    return columns;
  }, [showWeekends]);
  const calendarGridClassName = showWeekends ? "grid-cols-7" : "grid-cols-5";
  const providerSelectionCount = useMemo(() => {
    const count = totalProviderSelections(report.days);
    return count;
  }, [report.days]);
  const providerCount = useMemo(() => {
    const count = uniqueProviderCount(report.days);
    return count;
  }, [report.days]);
  const dayCount = useMemo(() => {
    const count = daysWithProviderSelections(report.days);
    return count;
  }, [report.days]);
  const scheduledProviderCount = useMemo(() => {
    const count = totalScheduledProviders(report.days);
    return count;
  }, [report.days]);
  const unscheduledProviderCount = useMemo(() => {
    const count = totalUnscheduledProviders(report.days);
    return count;
  }, [report.days]);

  useEffect(() => {
    const reportMatchesSelection = report.year === selectedYear && report.month === selectedMonth;
    const reportSchedulePeriodIds = selectedSchedulePeriodIdsFromReport(report);
    const schedulePeriodsMatch = schedulePeriodIdsMatch(
      reportSchedulePeriodIds,
      selectedSchedulePeriodIds,
    );
    const reportMatchesRequestedState = reportMatchesSelection && schedulePeriodsMatch;

    if (reportMatchesRequestedState) {
      return;
    }

    let isMounted = true;

    async function loadReport() {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const nextReport = await getMonthlyAvailabilityReport(
          selectedYear,
          selectedMonth,
          selectedSchedulePeriodIds,
        );

        if (isMounted) {
          setReport(nextReport);
          const nextSchedulePeriodIds = selectedSchedulePeriodIdsFromReport(nextReport);
          const nextIdsMatchCurrentIds = schedulePeriodIdsMatch(
            nextSchedulePeriodIds,
            selectedSchedulePeriodIds,
          );

          if (!nextIdsMatchCurrentIds) {
            setSelectedSchedulePeriodIds(nextSchedulePeriodIds);
          }
        }
      } catch (error) {
        if (isMounted) {
          const message = error instanceof Error ? error.message : "Failed to load report.";
          setErrorMessage(message);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadReport();

    return () => {
      isMounted = false;
    };
  }, [
    report,
    selectedMonth,
    selectedSchedulePeriodIds,
    selectedSchedulePeriodIdKey,
    selectedYear,
  ]);

  function updateSelectedYear(value: string) {
    const parsedYear = Number.parseInt(value, 10);
    const parsedYearIsInvalid = Number.isNaN(parsedYear);

    if (parsedYearIsInvalid) {
      return;
    }

    setSelectedYear(parsedYear);
  }

  function updateSelectedMonth(value: string) {
    const parsedMonth = Number.parseInt(value, 10);
    const parsedMonthIsInvalid = Number.isNaN(parsedMonth);

    if (parsedMonthIsInvalid) {
      return;
    }

    setSelectedMonth(parsedMonth);
  }

  function updateSelectedSchedulePeriod(groupKey: string, schedulePeriodId: string) {
    const groupHasSelection = report.schedule_candidate_groups.some((group) => {
      const groupMatches = group.group_key === groupKey;
      return groupMatches;
    });

    if (!groupHasSelection) {
      return;
    }

    const nextIds = report.schedule_candidate_groups.map((group) => {
      const groupMatches = group.group_key === groupKey;

      if (groupMatches) {
        return schedulePeriodId;
      }

      return group.selected_schedule_period_id;
    });
    setSelectedSchedulePeriodIds(nextIds);
  }

  function handlePrintButtonClick() {
    window.print();
  }

  return (
    <div className="monthly-availability-report space-y-5">
      <section className="monthly-availability-print-only">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-slate-950">
              Monthly Availability
            </h1>
            <p className="mt-1 text-sm font-medium text-slate-600">
              {formatSelectedMonth(report)}
            </p>
          </div>
          <div className="text-right text-xs font-medium text-slate-600">
            <p>{providerSelectionCount} selections</p>
            <p>{providerCount} providers</p>
          </div>
        </div>
        <div className="mt-3 grid gap-2 text-xs sm:grid-cols-5">
          <div>
            <p className="font-semibold uppercase text-slate-500">Days</p>
            <p className="mt-0.5 font-semibold text-slate-950">{dayCount}</p>
          </div>
          <div>
            <p className="font-semibold uppercase text-slate-500">Selections</p>
            <p className="mt-0.5 font-semibold text-slate-950">
              {providerSelectionCount}
            </p>
          </div>
          <div>
            <p className="font-semibold uppercase text-slate-500">Scheduled</p>
            <p className="mt-0.5 font-semibold text-teal-800">
              {scheduledProviderCount}
            </p>
          </div>
          <div>
            <p className="font-semibold uppercase text-slate-500">Available</p>
            <p className="mt-0.5 font-semibold text-amber-800">
              {unscheduledProviderCount}
            </p>
          </div>
          <div>
            <p className="font-semibold uppercase text-slate-500">View</p>
            <p className="mt-0.5 font-semibold text-slate-950">
              {showWeekends ? "Weekends shown" : "Weekdays only"}
            </p>
          </div>
        </div>
        {report.schedule_candidate_groups.length > 0 ? (
          <div className="mt-3 grid gap-1 text-xs sm:grid-cols-2">
            {report.schedule_candidate_groups.map((group) => {
              const candidate = selectedScheduleCandidate(group);

              return (
                <div key={group.group_key}>
                  <span className="font-semibold text-slate-950">
                    {formatScheduleGroupRange(group)}
                  </span>
                  {candidate !== undefined ? (
                    <span className="text-slate-600">
                      {" "}
                      {candidateLabel(candidate)}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
      </section>

      <section className="monthly-availability-screen-only rounded-md border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">
              {formatSelectedMonth(report)}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {providerSelectionCount} availability selections across {dayCount} days.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-[minmax(160px,1fr)_120px_auto]">
            <label className="flex flex-col gap-2 text-sm text-slate-700">
              <span className="font-semibold text-slate-950">Month</span>
              <select
                className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-950 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-100"
                value={selectedMonth}
                onChange={(event) => updateSelectedMonth(event.target.value)}
              >
                {monthOptions.map((month) => {
                  return (
                    <option key={month.value} value={month.value}>
                      {month.label}
                    </option>
                  );
                })}
              </select>
            </label>
            <label className="flex flex-col gap-2 text-sm text-slate-700">
              <span className="font-semibold text-slate-950">Year</span>
              <input
                className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-950 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-100"
                type="number"
                min={2000}
                max={2100}
                value={selectedYear}
                onChange={(event) => updateSelectedYear(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="inline-flex h-10 items-center justify-center self-end rounded-md bg-teal-700 px-4 text-sm font-semibold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300"
              disabled={isLoading}
              onClick={handlePrintButtonClick}
            >
              Print / PDF
            </button>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300"
              checked={showWeekends}
              onChange={(event) => setShowWeekends(event.target.checked)}
            />
            <span>Show weekends</span>
          </label>
        </div>
        <div className="mt-4 grid gap-3 text-sm sm:grid-cols-5">
          <div>
            <p className="text-xs font-semibold uppercase text-slate-500">Providers</p>
            <p className="mt-1 text-xl font-semibold text-slate-950">{providerCount}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase text-slate-500">Days</p>
            <p className="mt-1 text-xl font-semibold text-slate-950">{dayCount}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase text-slate-500">Selections</p>
            <p className="mt-1 text-xl font-semibold text-slate-950">
              {providerSelectionCount}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase text-slate-500">Scheduled</p>
            <p className="mt-1 text-xl font-semibold text-teal-800">
              {scheduledProviderCount}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase text-slate-500">Available</p>
            <p className="mt-1 text-xl font-semibold text-amber-800">
              {unscheduledProviderCount}
            </p>
          </div>
        </div>
        {report.schedule_candidate_groups.length > 0 ? (
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {report.schedule_candidate_groups.map((group) => {
              const hasMultipleCandidates = group.candidates.length > 1;
              const selectClassName = hasMultipleCandidates
                ? "border-amber-300 bg-amber-50"
                : "border-slate-300 bg-white";
              return (
                <label
                  key={group.group_key}
                  className="flex flex-col gap-2 rounded-md border border-slate-200 p-3 text-sm text-slate-700"
                >
                  <span className="font-semibold text-slate-950">
                    {formatScheduleGroupRange(group)}
                  </span>
                  <select
                    className={`h-10 rounded-md border px-3 text-sm font-semibold text-slate-950 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-100 ${selectClassName}`}
                    value={group.selected_schedule_period_id}
                    onChange={(event) => {
                      updateSelectedSchedulePeriod(
                        group.group_key,
                        event.target.value,
                      );
                    }}
                  >
                    {group.candidates.map((candidate) => {
                      return (
                        <option
                          key={candidate.schedule_period_id}
                          value={candidate.schedule_period_id}
                        >
                          {candidateLabel(candidate)}
                        </option>
                      );
                    })}
                  </select>
                </label>
              );
            })}
          </div>
        ) : null}
        {isLoading ? <p className="mt-4 text-sm text-slate-500">Loading report...</p> : null}
        {errorMessage !== null ? (
          <p className="mt-4 text-sm text-rose-700">{errorMessage}</p>
        ) : null}
      </section>

      <section className="monthly-availability-print-calendar overflow-x-auto">
        <div className="min-w-[960px]">
          <div className={`monthly-availability-calendar-grid grid gap-2 ${calendarGridClassName}`}>
            {visibleColumns.map((column) => {
              return (
                <div
                  key={column.label}
                  className="monthly-availability-weekday-header px-2 py-1 text-xs font-semibold uppercase text-slate-500"
                >
                  {column.label}
                </div>
              );
            })}
            {cells.map((cell) => {
              if (cell.kind === "empty") {
                return (
                  <div
                    key={cell.key}
                    className="monthly-availability-empty-cell min-h-72 rounded-md border border-dashed border-slate-200 bg-slate-100/60"
                  />
                );
              }

              return <div key={cell.key}>{calendarDayCell(cell.day)}</div>;
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
