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

const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dateAtUtcMidnight(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  return date;
}

function calendarCells(days: MonthlyAvailabilityDayApi[]): CalendarCell[] {
  const firstDay = days[0];
  const cells: CalendarCell[] = [];

  if (firstDay === undefined) {
    return cells;
  }

  const firstDate = dateAtUtcMidnight(firstDay.date);
  const leadingEmptyCellCount = firstDate.getUTCDay();

  for (let index = 0; index < leadingEmptyCellCount; index += 1) {
    const key = `empty-leading-${index}`;
    const cell: CalendarEmptyCell = { kind: "empty", key };
    cells.push(cell);
  }

  days.forEach((day) => {
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

function totalProviderSelections(days: MonthlyAvailabilityDayApi[]): number {
  const total = days.reduce((currentTotal, day) => {
    const nextTotal = currentTotal + day.providers.length;
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

function daysWithProviderSelections(days: MonthlyAvailabilityDayApi[]): number {
  const matchingDays = days.filter((day) => {
    const hasProviders = day.providers.length > 0;
    return hasProviders;
  });
  const count = matchingDays.length;
  return count;
}

function providerOptionMarkers(provider: MonthlyAvailabilityProviderApi) {
  return (
    <span className="flex flex-wrap gap-1">
      {provider.options.map((option) => {
        const label = optionLabel(option);
        const toneClassName = optionToneClassName(option);
        return (
          <span
            key={option}
            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${toneClassName}`}
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
  const backgroundClassName = hasProviders ? "bg-white" : "bg-slate-50";
  const cellClassName = `min-h-36 rounded-md border border-slate-200 p-2 ${backgroundClassName}`;

  return (
    <div className={cellClassName}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-slate-950">{dayNumber}</span>
        <span className="text-xs font-medium text-slate-500">
          {day.providers.length}
        </span>
      </div>
      <div className="mt-2 max-h-28 space-y-2 overflow-y-auto pr-1">
        {day.providers.map((provider) => {
          return (
            <div
              key={`${provider.provider_id}-${provider.schedule_period_id}`}
              className="rounded-md border border-slate-100 bg-white px-2 py-1 shadow-sm"
            >
              <p className="truncate text-xs font-semibold text-slate-950">
                {provider.provider_display_name}
              </p>
              <div className="mt-1">{providerOptionMarkers(provider)}</div>
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
  const [report, setReport] = useState(initialReport);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const cells = useMemo(() => {
    const nextCells = calendarCells(report.days);
    return nextCells;
  }, [report.days]);
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

  useEffect(() => {
    const reportMatchesSelection = report.year === selectedYear && report.month === selectedMonth;

    if (reportMatchesSelection) {
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
        );

        if (isMounted) {
          setReport(nextReport);
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
  }, [report.month, report.year, selectedMonth, selectedYear]);

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

  return (
    <div className="space-y-5">
      <section className="rounded-md border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">
              {formatSelectedMonth(report)}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {providerSelectionCount} availability selections across {dayCount} days.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-[minmax(160px,1fr)_120px]">
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
          </div>
        </div>
        <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
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
        </div>
        {isLoading ? <p className="mt-4 text-sm text-slate-500">Loading report...</p> : null}
        {errorMessage !== null ? (
          <p className="mt-4 text-sm text-rose-700">{errorMessage}</p>
        ) : null}
      </section>

      <section className="overflow-x-auto">
        <div className="min-w-[960px]">
          <div className="grid grid-cols-7 gap-2">
            {weekdayLabels.map((weekday) => {
              return (
                <div
                  key={weekday}
                  className="px-2 py-1 text-xs font-semibold uppercase text-slate-500"
                >
                  {weekday}
                </div>
              );
            })}
            {cells.map((cell) => {
              if (cell.kind === "empty") {
                return (
                  <div
                    key={cell.key}
                    className="min-h-36 rounded-md border border-dashed border-slate-200 bg-slate-100/60"
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
