"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import {
  saveCurrentProviderPreferences,
  saveCurrentProviderWeeklyAvailability,
  type ProviderPortalAvailabilityRecord,
  type ProviderWeeklyAvailabilityRecord,
} from "@/lib/api";
import type {
  AvailabilityOption,
  Weekday,
} from "@/lib/schemas/provider-weekly-availability";

import { CalendarAvailabilityView } from "./provider-calendar-availability-view";
import { PreferencesView } from "./provider-preferences-view";
import type {
  ProviderPortalWorkspaceProps,
  ShiftRequestField,
} from "./provider-portal-types";
import {
  centerPreferenceDrafts,
  clampValue,
  countWorkAvailableDays,
  dateAtUtcMidnight,
  isoDateForDate,
  monthStartIsoForDate,
  optionIsExclusive,
  preferencePayload,
  providerPortalSectionFromViewValue,
  shiftTypePreferenceDrafts,
} from "./provider-portal-utils";
import { WeekAvailabilityView } from "./provider-week-availability-view";

export function ProviderPortalWorkspace({
  availabilityRecords,
  preferenceOptions,
  preferences,
  profile,
}: ProviderPortalWorkspaceProps) {
  const firstWeekId = availabilityRecords.at(0)?.scheduleWeekId ?? "";
  const todayIso = isoDateForDate(new Date());
  const firstWeekStartDate = availabilityRecords.at(0)?.scheduleWeekStartDate ?? todayIso;
  const firstWeekStart = dateAtUtcMidnight(firstWeekStartDate);
  const firstMonthStartIso = monthStartIsoForDate(firstWeekStart);
  const searchParams = useSearchParams();
  const requestedSection = searchParams.get("view");
  const requestedWeekId = searchParams.get("weekId");
  const activeSection = providerPortalSectionFromViewValue(requestedSection);
  const [records, setRecords] = useState(availabilityRecords);
  const [selectedMonthStartIso, setSelectedMonthStartIso] = useState(firstMonthStartIso);
  const [centerDrafts, setCenterDrafts] = useState(() => {
    const drafts = centerPreferenceDrafts(preferenceOptions, preferences);
    return drafts;
  });
  const [shiftTypeDrafts, setShiftTypeDrafts] = useState(() => {
    const drafts = shiftTypePreferenceDrafts(preferences);
    return drafts;
  });
  const [availabilityMessage, setAvailabilityMessage] = useState<string | null>(null);
  const [preferenceMessage, setPreferenceMessage] = useState<string | null>(null);
  const [isSavingAvailability, setIsSavingAvailability] = useState(false);
  const [isSavingPreferences, setIsSavingPreferences] = useState(false);
  const requestedWeekExists = records.some((record) => {
    const matchesWeek = record.scheduleWeekId === requestedWeekId;
    return matchesWeek;
  });
  const selectedWeekId = requestedWeekExists ? requestedWeekId ?? firstWeekId : firstWeekId;

  const selectedRecord = useMemo(() => {
    const record = records.find((candidate) => {
      const matchesWeek = candidate.scheduleWeekId === selectedWeekId;
      return matchesWeek;
    });
    const selected = record ?? null;
    return selected;
  }, [records, selectedWeekId]);

  const incompleteCount = records.filter((record) => {
    const isIncomplete = !record.completion.isComplete;
    return isIncomplete;
  }).length;
  const allWeeksComplete = incompleteCount === 0;
  const completionText = allWeeksComplete
    ? "All availability weeks complete"
    : `${incompleteCount} availability weeks incomplete`;

  function updateSelectedAvailability(nextAvailability: ProviderWeeklyAvailabilityRecord) {
    setRecords((currentRecords) => {
      const nextRecords = currentRecords.map((record) => {
        if (record.scheduleWeekId !== selectedWeekId) {
          return record;
        }

        const nextRecord = {
          ...record,
          availability: nextAvailability,
        };
        return nextRecord;
      });
      return nextRecords;
    });
  }

  function updateRecordAvailability(
    recordId: string,
    nextAvailability: ProviderWeeklyAvailabilityRecord,
  ) {
    setRecords((currentRecords) => {
      const nextRecords = currentRecords.map((record) => {
        if (record.scheduleWeekId !== recordId) {
          return record;
        }

        const nextRecord = {
          ...record,
          availability: nextAvailability,
        };
        return nextRecord;
      });
      return nextRecords;
    });
  }

  function updateDay(weekday: Weekday, option: AvailabilityOption, isChecked: boolean) {
    if (selectedRecord === null) {
      return;
    }

    const nextDays = selectedRecord.availability.days.map((day) => {
      if (day.weekday !== weekday) {
        return day;
      }

      const optionsWithoutSelected = day.options.filter((value) => value !== option);
      const workOptions = day.options.filter((value) => !optionIsExclusive(value));
      const checkedExclusiveOptions: AvailabilityOption[] = [option];
      const checkedWorkOptions = [...workOptions, option];
      const checkedOptions = optionIsExclusive(option) ? checkedExclusiveOptions : checkedWorkOptions;
      const optionsWithClickedChoice = isChecked ? checkedOptions : optionsWithoutSelected;
      const optionsWithoutExclusiveIfNeeded = optionsWithClickedChoice.filter((value) => {
        const keepValue = isChecked || !optionIsExclusive(value);
        return keepValue;
      });
      const uniqueOptions = Array.from(new Set(optionsWithoutExclusiveIfNeeded));
      const nextOptions = uniqueOptions.length === 0 ? ["unset" as AvailabilityOption] : uniqueOptions;
      const nextDay = {
        weekday: day.weekday,
        options: nextOptions,
      };
      return nextDay;
    });
    const workAvailableDayCount = countWorkAvailableDays(nextDays);
    const currentMinimum = selectedRecord.availability.minShiftsRequested;
    const currentMaximum = selectedRecord.availability.maxShiftsRequested;
    const nextMinimum = clampValue(currentMinimum, 0, workAvailableDayCount);
    const nextMaximum = clampValue(currentMaximum, nextMinimum, workAvailableDayCount);
    const nextAvailability = {
      ...selectedRecord.availability,
      minShiftsRequested: nextMinimum,
      maxShiftsRequested: nextMaximum,
      days: nextDays,
    };
    updateSelectedAvailability(nextAvailability);
  }

  function updateCalendarDay(
    record: ProviderPortalAvailabilityRecord,
    weekday: Weekday,
    option: AvailabilityOption,
    isChecked: boolean,
  ) {
    const nextDays = record.availability.days.map((day) => {
      if (day.weekday !== weekday) {
        return day;
      }

      const optionsWithoutSelected = day.options.filter((value) => value !== option);
      const workOptions = day.options.filter((value) => !optionIsExclusive(value));
      const checkedExclusiveOptions: AvailabilityOption[] = [option];
      const checkedWorkOptions = [...workOptions, option];
      const checkedOptions = optionIsExclusive(option) ? checkedExclusiveOptions : checkedWorkOptions;
      const optionsWithClickedChoice = isChecked ? checkedOptions : optionsWithoutSelected;
      const optionsWithoutExclusiveIfNeeded = optionsWithClickedChoice.filter((value) => {
        const keepValue = isChecked || !optionIsExclusive(value);
        return keepValue;
      });
      const uniqueOptions = Array.from(new Set(optionsWithoutExclusiveIfNeeded));
      const nextOptions = uniqueOptions.length === 0 ? ["unset" as AvailabilityOption] : uniqueOptions;
      const nextDay = {
        weekday: day.weekday,
        options: nextOptions,
      };
      return nextDay;
    });
    const workAvailableDayCount = countWorkAvailableDays(nextDays);
    const currentMinimum = record.availability.minShiftsRequested;
    const currentMaximum = record.availability.maxShiftsRequested;
    const nextMinimum = clampValue(currentMinimum, 0, workAvailableDayCount);
    const nextMaximum = clampValue(currentMaximum, nextMinimum, workAvailableDayCount);
    const nextAvailability = {
      ...record.availability,
      minShiftsRequested: nextMinimum,
      maxShiftsRequested: nextMaximum,
      days: nextDays,
    };
    updateRecordAvailability(record.scheduleWeekId, nextAvailability);
  }

  function updateShiftRequest(field: ShiftRequestField, value: string) {
    if (selectedRecord === null) {
      return;
    }

    const parsedValue = Number.parseFloat(value);
    const valueIsInvalid = Number.isNaN(parsedValue);

    if (valueIsInvalid) {
      return;
    }

    const workAvailableDayCount = countWorkAvailableDays(selectedRecord.availability.days);
    const currentMinimum = selectedRecord.availability.minShiftsRequested;
    const currentMaximum = selectedRecord.availability.maxShiftsRequested;
    const requestedMinimum = field === "min" ? parsedValue : currentMinimum;
    const requestedMaximum = field === "max" ? parsedValue : currentMaximum;
    const nextMinimum = clampValue(requestedMinimum, 0, workAvailableDayCount);
    const nextMaximum = clampValue(requestedMaximum, nextMinimum, workAvailableDayCount);
    const nextAvailability = {
      ...selectedRecord.availability,
      minShiftsRequested: nextMinimum,
      maxShiftsRequested: nextMaximum,
    };
    updateSelectedAvailability(nextAvailability);
  }

  function updateRecordShiftRequest(
    record: ProviderPortalAvailabilityRecord,
    field: ShiftRequestField,
    value: string,
  ) {
    const parsedValue = Number.parseFloat(value);
    const valueIsInvalid = Number.isNaN(parsedValue);

    if (valueIsInvalid) {
      return;
    }

    const workAvailableDayCount = countWorkAvailableDays(record.availability.days);
    const currentMinimum = record.availability.minShiftsRequested;
    const currentMaximum = record.availability.maxShiftsRequested;
    const requestedMinimum = field === "min" ? parsedValue : currentMinimum;
    const requestedMaximum = field === "max" ? parsedValue : currentMaximum;
    const nextMinimum = clampValue(requestedMinimum, 0, workAvailableDayCount);
    const nextMaximum = clampValue(requestedMaximum, nextMinimum, workAvailableDayCount);
    const nextAvailability = {
      ...record.availability,
      minShiftsRequested: nextMinimum,
      maxShiftsRequested: nextMaximum,
    };
    updateRecordAvailability(record.scheduleWeekId, nextAvailability);
  }

  async function saveAvailability() {
    if (selectedRecord === null) {
      return false;
    }

    setIsSavingAvailability(true);
    setAvailabilityMessage(null);
    try {
      const savedRecord = await saveCurrentProviderWeeklyAvailability(
        selectedRecord.scheduleWeekId,
        selectedRecord.availability,
      );
      setRecords((currentRecords) => {
        const nextRecords = currentRecords.map((record) => {
          if (record.scheduleWeekId !== savedRecord.scheduleWeekId) {
            return record;
          }

          return savedRecord;
        });
        return nextRecords;
      });
      setAvailabilityMessage("Availability saved.");
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Availability save failed.";
      setAvailabilityMessage(message);
      return false;
    } finally {
      setIsSavingAvailability(false);
    }
  }

  async function saveAvailabilityRecord(record: ProviderPortalAvailabilityRecord) {
    setIsSavingAvailability(true);
    setAvailabilityMessage(null);
    try {
      const savedRecord = await saveCurrentProviderWeeklyAvailability(
        record.scheduleWeekId,
        record.availability,
      );
      setRecords((currentRecords) => {
        const nextRecords = currentRecords.map((currentRecord) => {
          if (currentRecord.scheduleWeekId !== savedRecord.scheduleWeekId) {
            return currentRecord;
          }

          return savedRecord;
        });
        return nextRecords;
      });
      setAvailabilityMessage("Availability saved.");
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Availability save failed.";
      setAvailabilityMessage(message);
      return false;
    } finally {
      setIsSavingAvailability(false);
    }
  }

  async function savePreferences() {
    setIsSavingPreferences(true);
    setPreferenceMessage(null);
    try {
      const payload = preferencePayload(centerDrafts, shiftTypeDrafts);
      await saveCurrentProviderPreferences(payload);
      setPreferenceMessage("Preferences saved.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Preference save failed.";
      setPreferenceMessage(message);
    } finally {
      setIsSavingPreferences(false);
    }
  }

  return (
    <div className="grid gap-4">
      <section className="rounded-md border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-sm text-slate-500">Signed in as</div>
            <div className="truncate text-lg font-semibold text-slate-950">
              {profile.display_name}
            </div>
            <div className="truncate text-sm text-slate-600">
              {profile.email ?? "No email on file"}
            </div>
          </div>
          <div className="rounded-md border border-slate-200 px-3 py-2">
            <div className="text-sm font-semibold text-slate-950">{completionText}</div>
            <div className="mt-1 text-xs text-slate-500">
              {records.length} availability weeks
            </div>
          </div>
        </div>
      </section>

      <div className="min-w-0">
        {activeSection === "weekAvailability" ? (
          <WeekAvailabilityView
            availabilityMessage={availabilityMessage}
            isSavingAvailability={isSavingAvailability}
            onDayChange={updateDay}
            onSave={saveAvailability}
            onShiftRequestChange={updateShiftRequest}
            record={selectedRecord}
          />
        ) : null}
        {activeSection === "calendarAvailability" ? (
          <CalendarAvailabilityView
            availabilityMessage={availabilityMessage}
            isSavingAvailability={isSavingAvailability}
            monthStartIso={selectedMonthStartIso}
            onCalendarDayChange={updateCalendarDay}
            onMonthChange={setSelectedMonthStartIso}
            onRecordSave={saveAvailabilityRecord}
            onRecordShiftRequestChange={updateRecordShiftRequest}
            records={records}
          />
        ) : null}
        {activeSection === "preferences" ? (
          <PreferencesView
            centerDrafts={centerDrafts}
            isSavingPreferences={isSavingPreferences}
            onCenterDraftsChange={setCenterDrafts}
            onSave={savePreferences}
            onShiftTypeDraftsChange={setShiftTypeDrafts}
            preferenceMessage={preferenceMessage}
            shiftTypeDrafts={shiftTypeDrafts}
          />
        ) : null}
      </div>
    </div>
  );
}
