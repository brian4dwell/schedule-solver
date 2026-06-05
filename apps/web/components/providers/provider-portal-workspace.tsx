"use client";

import { useMemo, useState } from "react";

import {
  saveCurrentProviderPreferences,
  saveCurrentProviderWeeklyAvailability,
  type ProviderPortalAvailabilityRecord,
  type ProviderPortalPreferenceOptionRecord,
  type ProviderPortalProfile,
  type ProviderPreferences,
  type ProviderPreferencesSavePayload,
  type ProviderWeeklyAvailabilityRecord,
} from "@/lib/api";
import {
  type AvailabilityOption,
  type Weekday,
} from "@/lib/schemas/provider-weekly-availability";

type ProviderPortalWorkspaceProps = {
  availabilityRecords: ProviderPortalAvailabilityRecord[];
  preferenceOptions: ProviderPortalPreferenceOptionRecord;
  preferences: ProviderPreferences;
  profile: ProviderPortalProfile;
};

type CenterPreferenceDraft = {
  centerId: string;
  name: string;
  preferenceLevel: number;
};

type ShiftTypePreferenceDraft = {
  shiftType: string;
  preferenceLevel: number;
};

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

const shiftTypes = [
  "full_shift",
  "first_half",
  "second_half",
  "short_shift",
];

function labelFromSnake(value: string) {
  const withSpaces = value.replaceAll("_", " ");
  const label = withSpaces.charAt(0).toUpperCase() + withSpaces.slice(1);
  return label;
}

function optionIsExclusive(option: AvailabilityOption) {
  const optionIsUnset = option === "unset";
  const optionIsNone = option === "none";
  const isExclusive = optionIsUnset || optionIsNone;
  return isExclusive;
}

function optionIsWorkAvailability(option: AvailabilityOption) {
  const isWorkAvailability = !optionIsExclusive(option);
  return isWorkAvailability;
}

function dayHasWorkAvailability(day: { options: AvailabilityOption[] }) {
  const hasWorkAvailability = day.options.some(optionIsWorkAvailability);
  return hasWorkAvailability;
}

function countWorkAvailableDays(days: { options: AvailabilityOption[] }[]) {
  const workAvailableDays = days.filter(dayHasWorkAvailability);
  const workAvailableDayCount = workAvailableDays.length;
  return workAvailableDayCount;
}

function clampValue(value: number, minimum: number, maximum: number) {
  const atLeastMinimum = Math.max(value, minimum);
  const clampedValue = Math.min(atLeastMinimum, maximum);
  return clampedValue;
}

function centerPreferenceDrafts(
  options: ProviderPortalPreferenceOptionRecord,
  preferences: ProviderPreferences,
) {
  const drafts = options.centerOptions.map((center) => {
    const preference = preferences.center_preferences.find((candidate) => {
      const matchesCenter = candidate.center_id === center.centerId;
      return matchesCenter;
    });
    const preferenceLevel = preference?.preference_level ?? 0;
    const draft = {
      centerId: center.centerId,
      name: center.name,
      preferenceLevel,
    };
    return draft;
  });
  return drafts;
}

function shiftTypePreferenceDrafts(preferences: ProviderPreferences) {
  const drafts = shiftTypes.map((shiftType) => {
    const preference = preferences.shift_type_preferences.find((candidate) => {
      const matchesShiftType = candidate.shift_type === shiftType;
      return matchesShiftType;
    });
    const preferenceLevel = preference?.preference_level ?? 0;
    const draft = {
      shiftType,
      preferenceLevel,
    };
    return draft;
  });
  return drafts;
}

function preferencePayload(
  centerDrafts: CenterPreferenceDraft[],
  shiftTypeDrafts: ShiftTypePreferenceDraft[],
): ProviderPreferencesSavePayload {
  const centerPreferences = centerDrafts.map((draft) => {
    const preference = {
      center_id: draft.centerId,
      preference_level: draft.preferenceLevel,
    };
    return preference;
  });
  const shiftTypePreferences = shiftTypeDrafts.map((draft) => {
    const preference = {
      shift_type: draft.shiftType,
      preference_level: draft.preferenceLevel,
    };
    return preference;
  });
  const payload = {
    center_preferences: centerPreferences,
    shift_type_preferences: shiftTypePreferences,
  };
  return payload;
}

export function ProviderPortalWorkspace({
  availabilityRecords,
  preferenceOptions,
  preferences,
  profile,
}: ProviderPortalWorkspaceProps) {
  const firstWeekId = availabilityRecords.at(0)?.scheduleWeekId ?? "";
  const [records, setRecords] = useState(availabilityRecords);
  const [selectedWeekId, setSelectedWeekId] = useState(firstWeekId);
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
    ? "All open weeks complete"
    : `${incompleteCount} open weeks incomplete`;

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

  function updateShiftRequest(field: "min" | "max", value: string) {
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
      <section className="rounded-md border border-slate-200 bg-white p-4">
        <div className="text-sm text-slate-500">Signed in as</div>
        <div className="mt-1 text-lg font-semibold text-slate-950">{profile.display_name}</div>
        <div className="text-sm text-slate-600">{profile.email ?? "No email on file"}</div>
        <div className="mt-4 rounded-md border border-slate-200 p-3">
          <div className="text-sm font-semibold text-slate-950">{completionText}</div>
          <div className="mt-1 text-xs text-slate-500">
            {records.length} open availability weeks
          </div>
        </div>
        <div className="mt-4 grid gap-2">
          {records.map((record) => {
            const isSelected = record.scheduleWeekId === selectedWeekId;
            const selectedClass = isSelected ? "border-teal-700 bg-teal-50" : "border-slate-200 bg-white";
            const completeClass = record.completion.isComplete ? "text-emerald-700" : "text-amber-800";
            return (
              <button
                key={record.scheduleWeekId}
                type="button"
                className={`rounded-md border p-3 text-left ${selectedClass}`}
                onClick={() => setSelectedWeekId(record.scheduleWeekId)}
              >
                <div className="text-sm font-semibold text-slate-950">{record.scheduleWeekName}</div>
                <div className={`mt-1 text-xs font-medium ${completeClass}`}>
                  {record.completion.isComplete ? "Complete" : "Incomplete"}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <div className="grid gap-4">
        <section className="rounded-md border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-slate-950">
              {selectedRecord?.scheduleWeekName ?? "Availability"}
            </h2>
            {selectedRecord !== null ? (
              <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                {selectedRecord.completion.isComplete ? "Complete" : "Incomplete"}
              </span>
            ) : null}
          </div>
          {availabilityMessage ? (
            <p className="mt-3 text-sm text-slate-600">{availabilityMessage}</p>
          ) : null}
          {selectedRecord !== null ? (
            <div className="mt-4 grid gap-3">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="flex items-center justify-between gap-3 rounded-md border border-slate-200 p-3">
                  <span className="text-sm font-medium text-slate-700">Min shifts requested</span>
                  <input
                    className="w-24 rounded-md border border-slate-300 px-3 py-2 text-sm"
                    type="number"
                    min={0}
                    step={0.5}
                    value={selectedRecord.availability.minShiftsRequested}
                    onChange={(event) => updateShiftRequest("min", event.target.value)}
                  />
                </label>
                <label className="flex items-center justify-between gap-3 rounded-md border border-slate-200 p-3">
                  <span className="text-sm font-medium text-slate-700">Max shifts requested</span>
                  <input
                    className="w-24 rounded-md border border-slate-300 px-3 py-2 text-sm"
                    type="number"
                    min={0}
                    step={0.5}
                    value={selectedRecord.availability.maxShiftsRequested}
                    onChange={(event) => updateShiftRequest("max", event.target.value)}
                  />
                </label>
              </div>
              {weekdayOrder.map((weekday) => {
                const day = selectedRecord.availability.days.find((candidate) => {
                  const matchesWeekday = candidate.weekday === weekday;
                  return matchesWeekday;
                });
                const options = day?.options ?? ["unset"];
                return (
                  <div
                    key={weekday}
                    className="grid gap-3 rounded-md border border-slate-200 p-3 md:grid-cols-[120px_1fr]"
                  >
                    <div className="text-sm font-semibold text-slate-800">
                      {labelFromSnake(weekday)}
                    </div>
                    <div className="flex flex-wrap gap-3">
                      {availabilityOptions.map((option) => {
                        const isChecked = options.includes(option);
                        return (
                          <label key={option} className="flex items-center gap-2 text-sm text-slate-700">
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-slate-300"
                              checked={isChecked}
                              onChange={(event) => updateDay(weekday, option, event.target.checked)}
                            />
                            <span>{labelFromSnake(option)}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              <button
                type="button"
                className="w-fit rounded-md bg-teal-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                disabled={isSavingAvailability}
                onClick={saveAvailability}
              >
                {isSavingAvailability ? "Saving..." : "Save availability"}
              </button>
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-500">No open availability weeks.</p>
          )}
        </section>

        <section className="rounded-md border border-slate-200 bg-white p-4">
          <h2 className="text-base font-semibold text-slate-950">Preferences</h2>
          {preferenceMessage ? (
            <p className="mt-3 text-sm text-slate-600">{preferenceMessage}</p>
          ) : null}
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {centerDrafts.map((draft, index) => {
              return (
                <label key={draft.centerId} className="flex items-center justify-between gap-3 rounded-md border border-slate-200 p-3">
                  <span className="text-sm font-medium text-slate-700">{draft.name}</span>
                  <input
                    className="w-20 rounded-md border border-slate-300 px-3 py-2 text-sm"
                    type="number"
                    min={-3}
                    max={3}
                    value={draft.preferenceLevel}
                    onChange={(event) => {
                      const preferenceLevel = Number.parseInt(event.target.value, 10);
                      setCenterDrafts((currentDrafts) => {
                        const nextDrafts = [...currentDrafts];
                        nextDrafts[index] = {
                          ...draft,
                          preferenceLevel,
                        };
                        return nextDrafts;
                      });
                    }}
                  />
                </label>
              );
            })}
            {shiftTypeDrafts.map((draft, index) => {
              return (
                <label key={draft.shiftType} className="flex items-center justify-between gap-3 rounded-md border border-slate-200 p-3">
                  <span className="text-sm font-medium text-slate-700">{labelFromSnake(draft.shiftType)}</span>
                  <input
                    className="w-20 rounded-md border border-slate-300 px-3 py-2 text-sm"
                    type="number"
                    min={-3}
                    max={3}
                    value={draft.preferenceLevel}
                    onChange={(event) => {
                      const preferenceLevel = Number.parseInt(event.target.value, 10);
                      setShiftTypeDrafts((currentDrafts) => {
                        const nextDrafts = [...currentDrafts];
                        nextDrafts[index] = {
                          ...draft,
                          preferenceLevel,
                        };
                        return nextDrafts;
                      });
                    }}
                  />
                </label>
              );
            })}
          </div>
          <button
            type="button"
            className="mt-4 rounded-md bg-teal-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            disabled={isSavingPreferences}
            onClick={savePreferences}
          >
            {isSavingPreferences ? "Saving..." : "Save preferences"}
          </button>
        </section>
      </div>
    </div>
  );
}
