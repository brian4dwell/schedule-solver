"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

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
import { useToast } from "@/components/ui/toast-provider";

import { CalendarAvailabilityView } from "./provider-calendar-availability-view";
import { PreferencesView } from "./provider-preferences-view";
import type {
  ProviderPortalWorkspaceProps,
  ShiftRequestField,
} from "./provider-portal-types";
import {
  centerPreferenceDrafts,
  clampValue,
  dateAtUtcMidnight,
  isoDateForDate,
  monthStartIsoForDate,
  optionIsExclusive,
  preferencePayload,
  providerPortalSectionFromViewValue,
  shiftTypePreferenceDrafts,
  totalAvailableShiftCapacity,
} from "./provider-portal-utils";
import { WeekAvailabilityView } from "./provider-week-availability-view";

type ShiftRequestEditState = {
  scheduleWeekId: string;
  minShiftsWasEdited: boolean;
  maxShiftsWasEdited: boolean;
};

type ShiftRequestValues = {
  minShiftsRequested: number;
  maxShiftsRequested: number;
};

const maxShiftRequest = 14;

function shiftRequestEditStateForRecord(
  record: ProviderPortalAvailabilityRecord,
): ShiftRequestEditState {
  const availableShiftCapacity = totalAvailableShiftCapacity(record.availability.days);
  const minShiftsWasEdited = record.availability.minShiftsRequested !== 0;
  const maxShiftsWasEdited = record.availability.maxShiftsRequested !== availableShiftCapacity;
  const editState = {
    scheduleWeekId: record.scheduleWeekId,
    minShiftsWasEdited,
    maxShiftsWasEdited,
  };
  return editState;
}

function shiftRequestEditStatesForRecords(
  records: ProviderPortalAvailabilityRecord[],
) {
  const editStates = records.map(shiftRequestEditStateForRecord);
  return editStates;
}

export function ProviderPortalWorkspace({
  availabilityRecords,
  preferenceOptions,
  preferences,
  profile,
}: ProviderPortalWorkspaceProps) {
  const { showToast } = useToast();
  const firstWeekId = availabilityRecords.at(0)?.scheduleWeekId ?? "";
  const todayIso = isoDateForDate(new Date());
  const firstWeekStartDate = availabilityRecords.at(0)?.scheduleWeekStartDate ?? todayIso;
  const firstWeekStart = dateAtUtcMidnight(firstWeekStartDate);
  const firstMonthStartIso = monthStartIsoForDate(firstWeekStart);
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedSection = searchParams.get("view");
  const requestedWeekId = searchParams.get("weekId");
  const activeSection = providerPortalSectionFromViewValue(requestedSection);
  const [records, setRecords] = useState(availabilityRecords);
  const [shiftRequestEditStates, setShiftRequestEditStates] = useState(() => {
    const editStates = shiftRequestEditStatesForRecords(availabilityRecords);
    return editStates;
  });
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
  const hasAvailabilityWeeks = records.length > 0;
  const weekSelectorIsVisible = activeSection === "weekAvailability" && hasAvailabilityWeeks;

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

  function shiftRequestEditStateForWeek(scheduleWeekId: string) {
    const editState = shiftRequestEditStates.find((candidate) => {
      const matchesWeek = candidate.scheduleWeekId === scheduleWeekId;
      return matchesWeek;
    });
    const defaultEditState = {
      scheduleWeekId,
      minShiftsWasEdited: false,
      maxShiftsWasEdited: false,
    };
    const selectedEditState = editState ?? defaultEditState;
    return selectedEditState;
  }

  function setShiftRequestWasEdited(
    scheduleWeekId: string,
    field: ShiftRequestField,
  ) {
    setShiftRequestEditStates((currentStates) => {
      const nextStates = currentStates.map((currentState) => {
        if (currentState.scheduleWeekId !== scheduleWeekId) {
          return currentState;
        }

        const minShiftsWasEdited = field === "min"
          ? true
          : currentState.minShiftsWasEdited;
        const maxShiftsWasEdited = field === "max"
          ? true
          : currentState.maxShiftsWasEdited;
        const nextState = {
          scheduleWeekId: currentState.scheduleWeekId,
          minShiftsWasEdited,
          maxShiftsWasEdited,
        };
        return nextState;
      });
      const stateAlreadyExists = currentStates.some((currentState) => {
        const matchesWeek = currentState.scheduleWeekId === scheduleWeekId;
        return matchesWeek;
      });

      if (stateAlreadyExists) {
        return nextStates;
      }

      const nextState = {
        scheduleWeekId,
        minShiftsWasEdited: field === "min",
        maxShiftsWasEdited: field === "max",
      };
      const nextStatesWithNewState = [...currentStates, nextState];
      return nextStatesWithNewState;
    });
  }

  function replaceShiftRequestEditState(record: ProviderPortalAvailabilityRecord) {
    const savedEditState = shiftRequestEditStateForRecord(record);
    setShiftRequestEditStates((currentStates) => {
      const nextStates = currentStates.map((currentState) => {
        if (currentState.scheduleWeekId !== savedEditState.scheduleWeekId) {
          return currentState;
        }

        return savedEditState;
      });
      const stateAlreadyExists = currentStates.some((currentState) => {
        const matchesWeek = currentState.scheduleWeekId === savedEditState.scheduleWeekId;
        return matchesWeek;
      });

      if (stateAlreadyExists) {
        return nextStates;
      }

      const nextStatesWithSavedState = [...currentStates, savedEditState];
      return nextStatesWithSavedState;
    });
  }

  function normalizeShiftRequests(
    days: ProviderWeeklyAvailabilityRecord["days"],
    requestedMinimum: number,
    requestedMaximum: number,
    minShiftsWasEdited: boolean,
    maxShiftsWasEdited: boolean,
  ): ShiftRequestValues {
    const availableShiftCapacity = totalAvailableShiftCapacity(days);
    const defaultMinimum = 0;
    const defaultMaximum = availableShiftCapacity;
    const selectedMinimum = minShiftsWasEdited ? requestedMinimum : defaultMinimum;
    const selectedMaximum = maxShiftsWasEdited ? requestedMaximum : defaultMaximum;
    const nextMinimum = clampValue(selectedMinimum, 0, availableShiftCapacity);
    const minimumForMaximum = nextMinimum;
    const nextMaximum = clampValue(selectedMaximum, minimumForMaximum, maxShiftRequest);
    const shiftRequests = {
      minShiftsRequested: nextMinimum,
      maxShiftsRequested: nextMaximum,
    };
    return shiftRequests;
  }

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

  function selectWeek(weekId: string) {
    const params = new URLSearchParams(searchParams);
    params.set("view", "week");
    params.set("weekId", weekId);

    const query = params.toString();
    const href = `${pathname}?${query}`;
    router.push(href);
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
    const editState = shiftRequestEditStateForWeek(selectedRecord.scheduleWeekId);
    const currentMinimum = selectedRecord.availability.minShiftsRequested;
    const currentMaximum = selectedRecord.availability.maxShiftsRequested;
    const nextShiftRequests = normalizeShiftRequests(
      nextDays,
      currentMinimum,
      currentMaximum,
      editState.minShiftsWasEdited,
      editState.maxShiftsWasEdited,
    );
    const nextAvailability = {
      ...selectedRecord.availability,
      minShiftsRequested: nextShiftRequests.minShiftsRequested,
      maxShiftsRequested: nextShiftRequests.maxShiftsRequested,
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
    const editState = shiftRequestEditStateForWeek(record.scheduleWeekId);
    const currentMinimum = record.availability.minShiftsRequested;
    const currentMaximum = record.availability.maxShiftsRequested;
    const nextShiftRequests = normalizeShiftRequests(
      nextDays,
      currentMinimum,
      currentMaximum,
      editState.minShiftsWasEdited,
      editState.maxShiftsWasEdited,
    );
    const nextAvailability = {
      ...record.availability,
      minShiftsRequested: nextShiftRequests.minShiftsRequested,
      maxShiftsRequested: nextShiftRequests.maxShiftsRequested,
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

    const availableShiftCapacity = totalAvailableShiftCapacity(selectedRecord.availability.days);
    const currentMinimum = selectedRecord.availability.minShiftsRequested;
    const currentMaximum = selectedRecord.availability.maxShiftsRequested;
    const requestedMinimum = field === "min" ? parsedValue : currentMinimum;
    const requestedMaximum = field === "max" ? parsedValue : currentMaximum;
    const nextMinimum = clampValue(requestedMinimum, 0, availableShiftCapacity);
    const minimumForMaximum = nextMinimum;
    const nextMaximum = clampValue(requestedMaximum, minimumForMaximum, maxShiftRequest);
    const nextAvailability = {
      ...selectedRecord.availability,
      minShiftsRequested: nextMinimum,
      maxShiftsRequested: nextMaximum,
    };
    setShiftRequestWasEdited(selectedRecord.scheduleWeekId, field);
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

    const availableShiftCapacity = totalAvailableShiftCapacity(record.availability.days);
    const currentMinimum = record.availability.minShiftsRequested;
    const currentMaximum = record.availability.maxShiftsRequested;
    const requestedMinimum = field === "min" ? parsedValue : currentMinimum;
    const requestedMaximum = field === "max" ? parsedValue : currentMaximum;
    const nextMinimum = clampValue(requestedMinimum, 0, availableShiftCapacity);
    const minimumForMaximum = nextMinimum;
    const nextMaximum = clampValue(requestedMaximum, minimumForMaximum, maxShiftRequest);
    const nextAvailability = {
      ...record.availability,
      minShiftsRequested: nextMinimum,
      maxShiftsRequested: nextMaximum,
    };
    setShiftRequestWasEdited(record.scheduleWeekId, field);
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
      replaceShiftRequestEditState(savedRecord);
      setAvailabilityMessage("Availability saved.");
      showToast({
        title: "Availability saved",
        description: "Your availability changes were saved.",
        tone: "success",
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Availability save failed.";
      setAvailabilityMessage(message);
      showToast({
        title: "Availability save failed",
        description: message,
        tone: "error",
      });
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
      replaceShiftRequestEditState(savedRecord);
      setAvailabilityMessage("Availability saved.");
      showToast({
        title: "Availability saved",
        description: "Your availability changes were saved.",
        tone: "success",
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Availability save failed.";
      setAvailabilityMessage(message);
      showToast({
        title: "Availability save failed",
        description: message,
        tone: "error",
      });
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
      showToast({
        title: "Preferences saved",
        description: "Your preference changes were saved.",
        tone: "success",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Preference save failed.";
      setPreferenceMessage(message);
      showToast({
        title: "Preference save failed",
        description: message,
        tone: "error",
      });
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
            {weekSelectorIsVisible ? (
              <label className="mt-4 flex flex-wrap items-center gap-3 text-sm font-semibold text-slate-700">
                Week
                <select
                  className="h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-950 sm:w-72"
                  value={selectedWeekId}
                  onChange={(event) => selectWeek(event.target.value)}
                >
                  {records.map((record) => {
                    return (
                      <option
                        key={record.scheduleWeekId}
                        value={record.scheduleWeekId}
                      >
                        {record.scheduleWeekName}
                      </option>
                    );
                  })}
                </select>
              </label>
            ) : null}
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
