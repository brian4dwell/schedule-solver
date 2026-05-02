"use client";

import { useEffect, useMemo, useState } from "react";

import {
  deleteProviderWeeklyAvailability,
  getProviderWeeklyAvailability,
  saveProviderWeeklyAvailability,
  type Provider,
  type ProviderWeeklyAvailabilityRecord,
  type SchedulePeriod,
} from "@/lib/api";
import {
  type AvailabilityOption,
  type Weekday,
} from "@/lib/schemas/provider-weekly-availability";

const weekdayOrder: Weekday[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

const availabilityOptions: AvailabilityOption[] = [
  "full_shift",
  "first_half",
  "second_half",
  "short_shift",
  "none",
  "unset",
];

function labelForWeekday(weekday: Weekday) {
  const label = weekday.charAt(0).toUpperCase() + weekday.slice(1);
  return label;
}

function labelForOption(option: AvailabilityOption) {
  const withSpace = option.replaceAll("_", " ");
  const label = withSpace.charAt(0).toUpperCase() + withSpace.slice(1);
  return label;
}

function createDayMap(record: ProviderWeeklyAvailabilityRecord) {
  const dayMap = new Map<Weekday, AvailabilityOption[]>();
  record.days.forEach((day) => {
    dayMap.set(day.weekday, day.options);
  });
  return dayMap;
}

function optionIsExclusive(option: AvailabilityOption) {
  const optionIsUnset = option === "unset";
  const optionIsNone = option === "none";
  const isExclusive = optionIsUnset || optionIsNone;
  return isExclusive;
}

export function ProviderAvailabilityEditor(props: {
  periods: SchedulePeriod[];
  providers: Provider[];
}) {
  const { periods, providers } = props;
  const firstPeriodId = periods.at(0)?.id ?? "";
  const firstProviderId = providers.at(0)?.id ?? "";
  const [scheduleWeekId, setScheduleWeekId] = useState(firstPeriodId);
  const [providerId, setProviderId] = useState(firstProviderId);
  const [record, setRecord] = useState<ProviderWeeklyAvailabilityRecord | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (scheduleWeekId === "") {
      return;
    }

    if (providerId === "") {
      return;
    }

    let isMounted = true;

    async function loadRecord() {
      setIsLoading(true);
      setErrorMessage(null);
      setSuccessMessage(null);
      try {
        const loadedRecord = await getProviderWeeklyAvailability(
          scheduleWeekId,
          providerId,
        );
        if (isMounted) {
          setRecord(loadedRecord);
        }
      } catch (error) {
        if (isMounted) {
          const message = error instanceof Error ? error.message : "Failed to load availability.";
          setErrorMessage(message);
          setRecord(null);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadRecord();

    return () => {
      isMounted = false;
    };
  }, [scheduleWeekId, providerId]);

  const dayMap = useMemo(() => {
    if (record === null) {
      return new Map<Weekday, AvailabilityOption[]>();
    }

    const mappedDays = createDayMap(record);
    return mappedDays;
  }, [record]);

  const isLocked = record?.isLocked ?? false;

  function updateDay(weekday: Weekday, option: AvailabilityOption, isChecked: boolean) {
    if (record === null) {
      return;
    }

    const nextDays = record.days.map((day) => {
      if (day.weekday !== weekday) {
        return day;
      }

      const currentOptions = day.options;
      const optionsWithoutSelectedOption = currentOptions.filter((value) => value !== option);
      const selectedExclusiveOption = optionIsExclusive(option);
      const workOptions = currentOptions.filter((value) => !optionIsExclusive(value));
      const checkedExclusiveOptions: AvailabilityOption[] = [option];
      const checkedWorkOptions = [...workOptions, option];
      const checkedOptions = selectedExclusiveOption ? checkedExclusiveOptions : checkedWorkOptions;
      const optionsWithClickedChoice = isChecked ? checkedOptions : optionsWithoutSelectedOption;
      const optionsWithExclusiveRule = optionsWithClickedChoice.filter((value) => {
        const keepOption = isChecked || !optionIsExclusive(value);
        return keepOption;
      });
      const uniqueOptions = Array.from(new Set(optionsWithExclusiveRule));
      const defaultOptions: AvailabilityOption[] = ["unset"];
      const optionsWithDefault = uniqueOptions.length > 0 ? uniqueOptions : defaultOptions;
      const nextDay = {
        weekday: day.weekday,
        options: optionsWithDefault,
      };
      return nextDay;
    });

    const nextRecord = {
      scheduleWeekId: record.scheduleWeekId,
      providerId: record.providerId,
      isLocked: record.isLocked,
      days: nextDays,
    };
    setRecord(nextRecord);
  }

  async function saveRecord() {
    if (record === null) {
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const savedRecord = await saveProviderWeeklyAvailability(
        scheduleWeekId,
        providerId,
        record,
      );
      setRecord(savedRecord);
      setSuccessMessage("Availability saved.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save availability.";
      setErrorMessage(message);
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteRecord() {
    setIsDeleting(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      await deleteProviderWeeklyAvailability(scheduleWeekId, providerId);
      const loadedRecord = await getProviderWeeklyAvailability(scheduleWeekId, providerId);
      setRecord(loadedRecord);
      setSuccessMessage("Availability deleted.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to delete availability.";
      setErrorMessage(message);
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <section className="rounded-md border border-slate-200 bg-white p-4">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm text-slate-700">
          <span className="font-medium">Schedule week</span>
          <select
            className="rounded-md border border-slate-300 px-3 py-2"
            value={scheduleWeekId}
            onChange={(event) => setScheduleWeekId(event.target.value)}
          >
            {periods.map((period) => {
              return (
                <option key={period.id} value={period.id}>
                  {period.name}
                </option>
              );
            })}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-700">
          <span className="font-medium">Provider</span>
          <select
            className="rounded-md border border-slate-300 px-3 py-2"
            value={providerId}
            onChange={(event) => setProviderId(event.target.value)}
          >
            {providers.map((provider) => {
              return (
                <option key={provider.id} value={provider.id}>
                  {provider.display_name}
                </option>
              );
            })}
          </select>
        </label>
      </div>

      <div className="mt-4">
        <span className="text-sm font-medium text-slate-700">Status</span>
        <span
          className={`ml-2 inline-flex rounded-md px-2 py-1 text-xs font-semibold ${isLocked ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}
        >
          {isLocked ? "Locked (Published)" : "Editable"}
        </span>
      </div>

      {isLoading ? <p className="mt-4 text-sm text-slate-500">Loading availability…</p> : null}
      {errorMessage ? <p className="mt-4 text-sm text-rose-700">{errorMessage}</p> : null}
      {successMessage ? <p className="mt-4 text-sm text-emerald-700">{successMessage}</p> : null}

      {record !== null ? (
        <div className="mt-4 grid gap-3">
          {weekdayOrder.map((weekday) => {
            const options = dayMap.get(weekday) ?? ["unset"];
            return (
              <label
                key={weekday}
                className="flex items-center justify-between gap-3 rounded-md border border-slate-200 p-3"
              >
                <span className="text-sm font-medium text-slate-700">{labelForWeekday(weekday)}</span>
                <div className="flex flex-wrap justify-end gap-3">
                  {availabilityOptions.map((item) => {
                    const isChecked = options.includes(item);
                    return (
                      <label key={item} className="flex items-center gap-2 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-slate-300"
                          checked={isChecked}
                          disabled={isLocked}
                          onChange={(event) => updateDay(weekday, item, event.target.checked)}
                        />
                        <span>{labelForOption(item)}</span>
                      </label>
                    );
                  })}
                </div>
              </label>
            );
          })}
        </div>
      ) : null}

      <div className="mt-4 flex gap-3">
        <button
          type="button"
          className="rounded-md bg-teal-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          onClick={saveRecord}
          disabled={record === null || isSaving || isDeleting || isLocked}
        >
          {isSaving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50"
          onClick={deleteRecord}
          disabled={record === null || isSaving || isDeleting || isLocked}
        >
          {isDeleting ? "Deleting…" : "Delete"}
        </button>
      </div>
    </section>
  );
}
