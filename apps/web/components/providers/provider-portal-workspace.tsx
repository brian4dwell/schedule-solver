"use client";

import { useMemo, useState } from "react";

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
import { ProviderPortalSidebar } from "./provider-portal-sidebar";
import type {
  ProviderPortalSection,
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
  const [records, setRecords] = useState(availabilityRecords);
  const [selectedWeekId, setSelectedWeekId] = useState(firstWeekId);
  const [selectedMonthStartIso, setSelectedMonthStartIso] = useState(firstMonthStartIso);
  const [activeSection, setActiveSection] = useState<ProviderPortalSection>("weekAvailability");
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
  ) {
    const nextDays = record.availability.days.map((day) => {
      if (day.weekday !== weekday) {
        return day;
      }

      const nextDay = {
        weekday: day.weekday,
        options: [option],
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
    setSelectedWeekId(record.scheduleWeekId);
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

  async function saveAvailability() {
    if (selectedRecord === null) {
      return;
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
    } catch (error) {
      const message = error instanceof Error ? error.message : "Availability save failed.";
      setAvailabilityMessage(message);
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
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <ProviderPortalSidebar
        activeSection={activeSection}
        completionText={completionText}
        onSectionChange={setActiveSection}
        onWeekSelect={setSelectedWeekId}
        profile={profile}
        records={records}
        selectedWeekId={selectedWeekId}
      />

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
            onDayChange={updateDay}
            onMonthChange={setSelectedMonthStartIso}
            onRecordSelect={setSelectedWeekId}
            onSave={saveAvailability}
            onShiftRequestChange={updateShiftRequest}
            record={selectedRecord}
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
