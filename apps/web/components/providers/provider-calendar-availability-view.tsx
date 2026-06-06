"use client";

import { useState } from "react";

import type { AvailabilityOption } from "@/lib/schemas/provider-weekly-availability";

import type { CalendarAvailabilityViewProps } from "./provider-portal-types";
import { ShiftRequestControls } from "./provider-shift-request-controls";
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

export function CalendarAvailabilityView({
  availabilityMessage,
  isSavingAvailability,
  monthStartIso,
  onCalendarDayChange,
  onMonthChange,
  onRecordSelect,
  onSave,
  onShiftRequestChange,
  records,
}: CalendarAvailabilityViewProps) {
  const [editingDateIso, setEditingDateIso] = useState<string | null>(null);
  const monthStart = dateAtUtcMidnight(monthStartIso);
  const monthLabel = monthLabelForDate(monthStart);
  const calendarDates = calendarDatesForMonth(monthStartIso);
  const monthOptions = monthOptionsForRecords(records);
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

  return (
    <section className="rounded-md border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-950">{monthLabel}</h2>
          <p className="mt-1 text-sm text-slate-600">Calendar availability</p>
        </div>
        {monthOptions.length > 0 ? (
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
        ) : null}
      </div>
      {availabilityMessage ? (
        <p className="mt-3 text-sm text-slate-600">{availabilityMessage}</p>
      ) : null}
      <p className="mt-3 max-w-3xl text-sm text-slate-600">
        Use this view to scan and edit availability across a month. Click an open day to choose a
        shift option; grey days are not open for provider entry, and locked days have already been
        published.
      </p>
      {records.length > 0 ? (
        <div className="mt-4 grid gap-4">
          <div className="grid grid-cols-7 border-t border-l border-slate-200 bg-slate-200">
            {calendarWeekdayLabels.map((label) => {
              return (
                <div key={label} className="bg-slate-50 px-1 py-2 text-center text-xs font-semibold uppercase text-slate-500">
                  {label}
                </div>
              );
            })}
            {calendarDates.map((date) => {
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

                    setEditingDateIso(dateIso);
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
              <button
                type="button"
                className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
                onClick={() => setEditingDateIso(null)}
              >
                Close
              </button>
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
            <div className="mt-4">
              <ShiftRequestControls
                maxShiftsRequested={editingRecord.availability.maxShiftsRequested}
                minShiftsRequested={editingRecord.availability.minShiftsRequested}
                onChange={onShiftRequestChange}
              />
            </div>
            <button
              type="button"
              className="mt-4 w-full rounded-md bg-teal-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 sm:w-fit"
              disabled={isSavingAvailability}
              onClick={onSave}
            >
              {isSavingAvailability ? "Saving..." : "Save availability"}
            </button>
          </div>
        </div>
      ) : null}
    </section>
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
