"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { createSchedulePeriod } from "@/lib/api";
import { schedulePeriodFormSchema } from "@/lib/schemas/schedule";

const MONDAY_DAY_INDEX = 1;
const DAYS_IN_SCHEDULE_WEEK = 7;
const SCHEDULE_WEEK_END_OFFSET_DAYS = DAYS_IN_SCHEDULE_WEEK - 1;

function formStringValue(formData: FormData, fieldName: string): string {
  const value = formData.get(fieldName);

  if (typeof value !== "string") {
    throw new Error("Schedule form is missing a required value.");
  }

  return value;
}

function parseDateAtStartOfDay(dateValue: string): Date {
  const startOfDayDate = new Date(`${dateValue}T00:00:00`);
  return startOfDayDate;
}

function addDays(date: Date, dayCount: number): Date {
  const nextDate = new Date(date);
  nextDate.setDate(date.getDate() + dayCount);
  return nextDate;
}

function formatDateInputValue(date: Date): string {
  const isoString = date.toISOString();
  const dateValue = isoString.slice(0, 10);
  return dateValue;
}

function dateValueIsMonday(dateValue: string): boolean {
  const startDate = parseDateAtStartOfDay(dateValue);
  const dayOfWeek = startDate.getUTCDay();
  const isMonday = dayOfWeek === MONDAY_DAY_INDEX;
  return isMonday;
}

function weekEndDateValue(startDateValue: string): string {
  const startDate = parseDateAtStartOfDay(startDateValue);
  const endDate = addDays(startDate, SCHEDULE_WEEK_END_OFFSET_DAYS);
  const endDateValue = formatDateInputValue(endDate);
  return endDateValue;
}

function scheduleNameValue(startDateValue: string): string {
  const startDate = parseDateAtStartOfDay(startDateValue);
  const formatter = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  const formattedStartDate = formatter.format(startDate);
  const nameValue = `Week of ${formattedStartDate}`;
  return nameValue;
}

export function SchedulePeriodForm() {
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [startDateValue, setStartDateValue] = useState("");
  const [scheduleName, setScheduleName] = useState("");
  const [nameWasEdited, setNameWasEdited] = useState(false);

  const hasStartDate = startDateValue.length > 0;
  const computedEndDateValue = hasStartDate ? weekEndDateValue(startDateValue) : "";

  function handleStartDateChange(nextStartDateValue: string) {
    setStartDateValue(nextStartDateValue);

    if (!dateValueIsMonday(nextStartDateValue)) {
      return;
    }

    if (nameWasEdited) {
      return;
    }

    const nextScheduleName = scheduleNameValue(nextStartDateValue);
    setScheduleName(nextScheduleName);
  }

  function handleNameChange(nextScheduleName: string) {
    setScheduleName(nextScheduleName);
    const hasNameChanges = nextScheduleName.length > 0;
    setNameWasEdited(hasNameChanges);
  }

  async function handleSubmit(formData: FormData) {
    setErrorMessage(null);

    try {
      const name = formStringValue(formData, "name");
      const startDate = formStringValue(formData, "startDate");
      const endDate = weekEndDateValue(startDate);
      const values = schedulePeriodFormSchema.parse({
        name,
        startDate,
        endDate,
      });

      if (!dateValueIsMonday(values.startDate)) {
        setErrorMessage("Start date must be a Monday.");
        return;
      }

      const period = await createSchedulePeriod(values);
      router.push(`/schedules/${period.id}`);
      router.refresh();
    } catch (error) {
      const nextErrorMessage =
        error instanceof Error ? error.message : "Schedule period save failed.";
      setErrorMessage(nextErrorMessage);
    }
  }

  return (
    <form
      action={handleSubmit}
      className="max-w-3xl space-y-5 rounded-md border border-slate-200 bg-white p-5"
    >
      {errorMessage ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {errorMessage}
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700 sm:col-span-2">
          Name
          <input
            name="name"
            required
            placeholder="Week of May 4, 2026"
            value={scheduleName}
            onChange={(event) => handleNameChange(event.target.value)}
            className="h-10 rounded-md border border-slate-300 px-3 text-slate-950"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Start date (Monday)
          <input
            name="startDate"
            type="date"
            required
            value={startDateValue}
            onChange={(event) => handleStartDateChange(event.target.value)}
            className="h-10 rounded-md border border-slate-300 px-3 text-slate-950"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          End date (Sunday)
          <input
            name="endDate"
            type="date"
            required
            value={computedEndDateValue}
            readOnly
            className="h-10 rounded-md border border-slate-300 bg-slate-100 px-3 text-slate-950"
          />
        </label>
      </div>
      <button
        type="submit"
        className="inline-flex h-10 items-center justify-center rounded-md bg-teal-700 px-4 text-sm font-semibold text-white hover:bg-teal-800"
      >
        Create schedule
      </button>
    </form>
  );
}
