"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { createSchedulePeriod } from "@/lib/api";
import type { SchedulePeriodFormValues } from "@/lib/schemas/schedule";
import { schedulePeriodFormSchema } from "@/lib/schemas/schedule";

function formStringValue(formData: FormData, fieldName: string): string {
  const value = formData.get(fieldName);

  if (typeof value !== "string") {
    throw new Error("Schedule form is missing a required value.");
  }

  return value;
}

function scheduleDatesAreValid(values: SchedulePeriodFormValues): boolean {
  const startDate = new Date(`${values.startDate}T00:00:00`);
  const endDate = new Date(`${values.endDate}T00:00:00`);
  const datesAreValid = endDate >= startDate;
  return datesAreValid;
}

export function SchedulePeriodForm() {
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(formData: FormData) {
    setErrorMessage(null);

    try {
      const values = schedulePeriodFormSchema.parse({
        name: formStringValue(formData, "name"),
        startDate: formStringValue(formData, "startDate"),
        endDate: formStringValue(formData, "endDate"),
      });
      const datesAreValid = scheduleDatesAreValid(values);

      if (!datesAreValid) {
        setErrorMessage("End date must be on or after start date.");
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
            placeholder="Week of May 4"
            className="h-10 rounded-md border border-slate-300 px-3 text-slate-950"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Start date
          <input
            name="startDate"
            type="date"
            required
            className="h-10 rounded-md border border-slate-300 px-3 text-slate-950"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          End date
          <input
            name="endDate"
            type="date"
            required
            className="h-10 rounded-md border border-slate-300 px-3 text-slate-950"
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
