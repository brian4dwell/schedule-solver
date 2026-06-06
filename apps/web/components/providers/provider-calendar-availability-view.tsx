"use client";

import { useState } from "react";

import type { ProviderPortalAvailabilityRecord } from "@/lib/api";
import type { AvailabilityOption } from "@/lib/schemas/provider-weekly-availability";

import type {
  CalendarAvailabilityViewProps,
  ShiftRequestField,
} from "./provider-portal-types";
import {
  calendarDatesForMonth,
  calendarEditableOptions,
  calendarWeekdayLabels,
  dateAtUtcMidnight,
  fullDateLabelForDate,
  isoDateForDate,
  labelFromSnake,
  monthLabelForDate,
  monthOptionsForRecords,
  monthStartIsoForDate,
  recordForDate,
  weekdayForDate,
} from "./provider-portal-utils";

type CalendarWeekRowProps = {
  dates: Date[];
  editingDateIso: string | null;
  isSavingAvailability: boolean;
  monthStartIso: string;
  onEditDate: (dateIso: string) => void;
  onRecordSave: (record: ProviderPortalAvailabilityRecord) => void;
  onRecordSelect: (weekId: string) => void;
  onRecordShiftRequestChange: (
    record: ProviderPortalAvailabilityRecord,
    field: ShiftRequestField,
    value: string,
  ) => void;
  records: ProviderPortalAvailabilityRecord[];
};

function calendarWeekRows(dates: Date[]) {
  const rows: Date[][] = [];

  for (let index = 0; index < dates.length; index += 5) {
    const row = dates.slice(index, index + 5);
    rows.push(row);
  }

  return rows;
}

function recordForWeekRow(
  dates: Date[],
  records: ProviderPortalAvailabilityRecord[],
  monthStartIso: string,
) {
  const inMonthDateWithRecord = dates.find((date) => {
    const dateMonthIso = monthStartIsoForDate(date);
    const dateIsInMonth = dateMonthIso === monthStartIso;
    const dateIso = isoDateForDate(date);
    const record = recordForDate(dateIso, records);
    const hasRecord = record !== null;
    const shouldUseDate = dateIsInMonth && hasRecord;
    return shouldUseDate;
  });
  const inMonthDate = dates.find((date) => {
    const dateMonthIso = monthStartIsoForDate(date);
    const dateIsInMonth = dateMonthIso === monthStartIso;
    return dateIsInMonth;
  });
  const dateForRecord = inMonthDateWithRecord ?? inMonthDate ?? dates.at(0) ?? null;

  if (dateForRecord === null) {
    return null;
  }

  const dateIso = isoDateForDate(dateForRecord);
  const record = recordForDate(dateIso, records);
  return record;
}

export function CalendarAvailabilityView({
  availabilityMessage,
  isSavingAvailability,
  monthStartIso,
  onCalendarDayChange,
  onMonthChange,
  onRecordSave,
  onRecordSelect,
  onRecordShiftRequestChange,
  onSave,
  records,
}: CalendarAvailabilityViewProps) {
  const [editingDateIso, setEditingDateIso] = useState<string | null>(null);
  const monthStart = dateAtUtcMidnight(monthStartIso);
  const monthLabel = monthLabelForDate(monthStart);
  const calendarDates = calendarDatesForMonth(monthStartIso);
  const calendarRows = calendarWeekRows(calendarDates);
  const monthOptions = monthOptionsForRecords(records);
  const currentMonthIndex = monthOptions.indexOf(monthStartIso);
  const previousMonthIndex = currentMonthIndex - 1;
  const nextMonthIndex = currentMonthIndex + 1;
  const previousMonthIso = monthOptions.at(previousMonthIndex) ?? null;
  const nextMonthIso = monthOptions.at(nextMonthIndex) ?? null;
  const hasPreviousMonth = previousMonthIso !== null;
  const hasNextMonth = nextMonthIso !== null;
  const editingRecord = editingDateIso === null
    ? null
    : recordForDate(editingDateIso, records);
  const editingWeekday = editingDateIso === null
    ? null
    : weekdayForDate(dateAtUtcMidnight(editingDateIso));
  const editingDay = editingRecord?.availability.days.find((candidate) => {
    const weekdayMatches = candidate.weekday === editingWeekday;
    return weekdayMatches;
  }) ?? null;

  function selectPreviousMonth() {
    if (previousMonthIso === null) {
      return;
    }

    onMonthChange(previousMonthIso);
  }

  function selectNextMonth() {
    if (nextMonthIso === null) {
      return;
    }

    onMonthChange(nextMonthIso);
  }

  async function saveAndCloseEditingDate() {
    const saveSucceeded = await onSave();

    if (!saveSucceeded) {
      return;
    }

    setEditingDateIso(null);
  }

  return (
    <section className="rounded-md border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-950">{monthLabel}</h2>
          <p className="mt-1 text-sm text-slate-600">Calendar availability</p>
        </div>
        {monthOptions.length > 0 ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Previous month"
              className="h-10 rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-700 disabled:opacity-40"
              disabled={!hasPreviousMonth}
              onClick={selectPreviousMonth}
            >
              {"<-"}
            </button>
            <select
              className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-950"
              value={monthStartIso}
              onChange={(event) => onMonthChange(event.target.value)}
            >
              {monthOptions.map((monthIso) => {
                const optionDate = dateAtUtcMidnight(monthIso);
                const optionLabel = monthLabelForDate(optionDate);
                return (
                  <option key={monthIso} value={monthIso}>
                    {optionLabel}
                  </option>
                );
              })}
            </select>
            <button
              type="button"
              aria-label="Next month"
              className="h-10 rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-700 disabled:opacity-40"
              disabled={!hasNextMonth}
              onClick={selectNextMonth}
            >
              {"->"}
            </button>
          </div>
        ) : null}
      </div>
      {availabilityMessage ? (
        <p className="mt-3 text-sm text-slate-600">{availabilityMessage}</p>
      ) : null}
      <p className="mt-3 max-w-3xl text-sm text-slate-600">
        Use this view to scan and edit availability across a month. Click an open day to choose a
        shift option; grey days are not open for provider entry, and locked days have already been
        published. Use the week request column to set min and max shifts for that week. Weekends
        are hidden.
      </p>
      {records.length > 0 ? (
        <div className="mt-4 grid gap-4">
          <div className="overflow-x-auto">
          <div className="grid min-w-[760px] grid-cols-[repeat(5,minmax(0,1fr))_minmax(132px,180px)] border-t border-l border-slate-200 bg-slate-200">
            {calendarWeekdayLabels.map((label) => {
              return (
                <div key={label} className="bg-slate-50 px-1 py-2 text-center text-xs font-semibold uppercase text-slate-500">
                  {label}
                </div>
              );
            })}
            <div className="bg-slate-50 px-1 py-2 text-center text-xs font-semibold uppercase text-slate-500">
              Week request
            </div>
            {calendarRows.map((dates) => {
              const firstDate = dates.at(0);
              const rowKey = firstDate === undefined ? "empty-week" : isoDateForDate(firstDate);
              return (
                <CalendarWeekRow
                  key={rowKey}
                  dates={dates}
                  editingDateIso={editingDateIso}
                  isSavingAvailability={isSavingAvailability}
                  monthStartIso={monthStartIso}
                  onEditDate={setEditingDateIso}
                  onRecordSave={onRecordSave}
                  onRecordSelect={onRecordSelect}
                  onRecordShiftRequestChange={onRecordShiftRequestChange}
                  records={records}
                />
              );
            })}
            </div>
          </div>
        </div>
      ) : (
        <p className="mt-4 text-sm text-slate-500">No open availability weeks.</p>
      )}
      {editingRecord !== null && editingWeekday !== null && editingDay !== null ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-4 sm:items-center">
          <div className="w-full max-w-lg rounded-md border border-slate-200 bg-white p-4 shadow-xl">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-slate-950">
                  {fullDateLabelForDate(dateAtUtcMidnight(editingDateIso ?? monthStartIso))}
                </h3>
                <p className="mt-1 text-sm text-slate-600">{editingRecord.scheduleWeekName}</p>
              </div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {calendarEditableOptions.map((option) => {
                const optionIsSelected = editingDay.options.includes(option);
                const selectedClass = optionIsSelected
                  ? "border-teal-700 bg-teal-50 text-teal-950"
                  : "border-slate-200 bg-white text-slate-700";
                const buttonClass = `rounded-md border px-3 py-3 text-left text-sm font-semibold ${selectedClass}`;

                return (
                  <button
                    key={option}
                    type="button"
                    className={buttonClass}
                    onClick={() => onCalendarDayChange(editingRecord, editingWeekday, option)}
                  >
                    {labelFromSnake(option)}
                  </button>
                );
              })}
            </div>
            <div className="mt-4 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
                onClick={() => setEditingDateIso(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-md bg-teal-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                disabled={isSavingAvailability}
                onClick={() => {
                  void saveAndCloseEditingDate();
                }}
              >
                {isSavingAvailability ? "Saving..." : "Save & close"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function CalendarWeekRow({
  dates,
  editingDateIso,
  isSavingAvailability,
  monthStartIso,
  onEditDate,
  onRecordSave,
  onRecordSelect,
  onRecordShiftRequestChange,
  records,
}: CalendarWeekRowProps) {
  const weekRecord = recordForWeekRow(dates, records, monthStartIso);

  return (
    <>
      {dates.map((date) => {
        const dateIso = isoDateForDate(date);
        const dayNumber = date.getUTCDate();
        const dateMonthIso = monthStartIsoForDate(date);
        const dateIsInMonth = dateMonthIso === monthStartIso;
        const record = recordForDate(dateIso, records);
        const weekday = weekdayForDate(date);
        const day = record?.availability.days.find((candidate) => {
          const weekdayMatches = candidate.weekday === weekday;
          return weekdayMatches;
        }) ?? null;
        const options = day?.options ?? ["unset"];
        const dateIsClosed = record === null || !dateIsInMonth;
        const dateIsLocked = record?.availability.isLocked ?? false;
        const dateIsEditable = !dateIsClosed && !dateIsLocked;
        const dateIsEditing = editingDateIso === dateIso;
        const cellBaseClass = "relative min-h-20 border-r border-b border-slate-200 p-1 text-left sm:min-h-28 sm:p-2";
        const closedClass = "bg-slate-100 text-slate-400";
        const openClass = dateIsEditing ? "bg-teal-50 ring-2 ring-inset ring-teal-600" : "bg-white text-slate-950";
        const lockedClass = dateIsLocked ? "bg-slate-50" : "";
        const cellStateClass = dateIsClosed ? closedClass : `${openClass} ${lockedClass}`;
        const cellClass = `${cellBaseClass} ${cellStateClass}`;

        return (
          <button
            key={dateIso}
            type="button"
            className={cellClass}
            disabled={!dateIsEditable}
            onClick={() => {
              if (record !== null) {
                onRecordSelect(record.scheduleWeekId);
              }

              onEditDate(dateIso);
            }}
          >
            <div className="flex items-center justify-between gap-1">
              <span className="text-xs font-semibold sm:text-sm">{dayNumber}</span>
              {dateIsLocked ? <LockIcon /> : null}
            </div>
            <CalendarDayAvailabilityMark
              isClosed={dateIsClosed}
              options={options}
            />
          </button>
        );
      })}
      <CalendarWeekRequestCell
        isSavingAvailability={isSavingAvailability}
        onRecordSave={onRecordSave}
        onRecordSelect={onRecordSelect}
        onRecordShiftRequestChange={onRecordShiftRequestChange}
        record={weekRecord}
      />
    </>
  );
}

function CalendarWeekRequestCell({
  isSavingAvailability,
  onRecordSave,
  onRecordSelect,
  onRecordShiftRequestChange,
  record,
}: {
  isSavingAvailability: boolean;
  onRecordSave: (record: ProviderPortalAvailabilityRecord) => void;
  onRecordSelect: (weekId: string) => void;
  onRecordShiftRequestChange: (
    record: ProviderPortalAvailabilityRecord,
    field: ShiftRequestField,
    value: string,
  ) => void;
  record: ProviderPortalAvailabilityRecord | null;
}) {
  if (record === null) {
    return <div className="min-h-20 border-r border-b border-slate-200 bg-slate-100 sm:min-h-28" />;
  }

  const isLocked = record.availability.isLocked;
  const completionClass = record.completion.isComplete ? "text-emerald-700" : "text-amber-800";

  return (
    <div className="min-h-20 border-r border-b border-slate-200 bg-white p-2 sm:min-h-28">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-slate-950">Week request</span>
        {isLocked ? <LockIcon /> : null}
      </div>
      <div className={`mt-1 text-xs font-medium ${completionClass}`}>
        {record.completion.isComplete ? "Complete" : "Incomplete"}
      </div>
      <div className="mt-2 grid gap-2">
        <label className="flex items-center justify-between gap-2 text-xs font-medium text-slate-700">
          Min
          <input
            className="h-8 w-16 rounded-md border border-slate-300 px-2 text-sm text-slate-950 disabled:bg-slate-100"
            type="number"
            min={0}
            step={0.5}
            disabled={isLocked}
            value={record.availability.minShiftsRequested}
            onChange={(event) => {
              onRecordSelect(record.scheduleWeekId);
              onRecordShiftRequestChange(record, "min", event.target.value);
            }}
          />
        </label>
        <label className="flex items-center justify-between gap-2 text-xs font-medium text-slate-700">
          Max
          <input
            className="h-8 w-16 rounded-md border border-slate-300 px-2 text-sm text-slate-950 disabled:bg-slate-100"
            type="number"
            min={0}
            step={0.5}
            disabled={isLocked}
            value={record.availability.maxShiftsRequested}
            onChange={(event) => {
              onRecordSelect(record.scheduleWeekId);
              onRecordShiftRequestChange(record, "max", event.target.value);
            }}
          />
        </label>
      </div>
      <button
        type="button"
        className="mt-2 w-full rounded-md bg-teal-700 px-2 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        disabled={isLocked || isSavingAvailability}
        onClick={() => onRecordSave(record)}
      >
        {isSavingAvailability ? "Saving..." : "Save"}
      </button>
    </div>
  );
}

function LockIcon() {
  return (
    <svg
      aria-label="Locked"
      className="h-3.5 w-3.5 text-slate-500"
      fill="none"
      role="img"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <rect height="11" rx="2" width="18" x="3" y="11" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function CalendarDayAvailabilityMark({
  isClosed,
  options,
}: {
  isClosed: boolean;
  options: AvailabilityOption[];
}) {
  const hasFullShift = options.includes("full_shift");
  const hasFirstHalf = options.includes("first_half");
  const hasSecondHalf = options.includes("second_half");
  const hasShortShift = options.includes("short_shift");
  const hasNone = options.includes("none");
  const hasUnset = options.includes("unset");

  if (isClosed) {
    return <div className="mt-3 h-12 rounded-md bg-slate-200/70 sm:h-16" />;
  }

  if (hasFullShift) {
    return (
      <div className="mt-3 flex h-12 items-center justify-center rounded-md bg-teal-600 text-xs font-bold text-white sm:h-16">
        Full
      </div>
    );
  }

  if (hasFirstHalf || hasSecondHalf) {
    return (
      <div className="mt-3 h-12 overflow-hidden rounded-md border border-teal-200 bg-white sm:h-16">
        <div className={`flex h-1/2 items-center justify-center text-[11px] font-bold ${hasFirstHalf ? "bg-teal-600 text-white" : "bg-white text-transparent"}`}>
          1st
        </div>
        <div className={`flex h-1/2 items-center justify-center text-[11px] font-bold ${hasSecondHalf ? "bg-teal-600 text-white" : "bg-white text-transparent"}`}>
          2nd
        </div>
      </div>
    );
  }

  if (hasShortShift) {
    return (
      <div className="mt-3 flex h-12 items-center justify-center rounded-md bg-white sm:h-16">
        <span className="rounded-md bg-teal-600 px-2 py-1 text-[11px] font-bold text-white">
          Short
        </span>
      </div>
    );
  }

  if (hasNone) {
    return (
      <div className="mt-3 flex h-12 items-center justify-center rounded-md bg-red-50 text-2xl font-bold text-red-700 sm:h-16">
        X
      </div>
    );
  }

  if (hasUnset) {
    return (
      <div className="mt-3 flex h-12 items-center justify-center rounded-md bg-amber-50 text-2xl font-bold text-amber-700 sm:h-16">
        ?
      </div>
    );
  }

  return (
    <div className="mt-3 flex h-12 items-center justify-center rounded-md bg-amber-50 text-2xl font-bold text-amber-700 sm:h-16">
      ?
    </div>
  );
}
