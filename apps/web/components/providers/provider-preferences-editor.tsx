"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import {
  saveManagerProviderPreferences,
  saveProviderPreferences,
  type Center,
  type ManagerProviderPreferences,
  type ManagerProviderPreferencesSavePayload,
  type Provider,
  type ProviderPreferences,
  type ProviderPreferencesSavePayload,
} from "@/lib/api";
import { useToast } from "@/components/ui/toast-provider";

type ProviderPreferencesEditorProps = {
  centers: Center[];
  managerPreferences: ManagerProviderPreferences;
  preferences: ProviderPreferences;
  provider: Provider;
};

type PreferenceLevel = -3 | -2 | 0 | 2 | 3;

type ShiftTypeValue = "full_shift" | "first_half" | "second_half" | "short_shift";

type CenterPreferenceDraft = {
  centerId: string;
  preferenceLevel: PreferenceLevel;
};

type ShiftTypePreferenceDraft = {
  shiftType: ShiftTypeValue;
  preferenceLevel: PreferenceLevel;
};

type ManagerCenterPreferenceDraft = CenterPreferenceDraft & {
  managerNote: string;
};

const preferenceLevels: PreferenceLevel[] = [3, 2, 0, -2, -3];

const shiftTypes: ShiftTypeValue[] = [
  "full_shift",
  "first_half",
  "second_half",
  "short_shift",
];

function labelForToken(value: string): string {
  const spacedValue = value.replaceAll("_", " ");
  const label = spacedValue.replace(/\b\w/g, (letter) => {
    const upperLetter = letter.toUpperCase();
    return upperLetter;
  });
  return label;
}

function labelForPreferenceLevel(value: PreferenceLevel): string {
  if (value === 3) {
    return "Strong prefer";
  }

  if (value === 2) {
    return "Prefer";
  }

  if (value === -2) {
    return "In a pinch";
  }

  if (value === -3) {
    return "Avoid";
  }

  return "Neutral";
}

function levelBadgeClassName(value: PreferenceLevel): string {
  if (value > 0) {
    return "bg-emerald-100 text-emerald-800";
  }

  if (value < 0) {
    return "bg-amber-100 text-amber-800";
  }

  return "bg-slate-100 text-slate-700";
}

function createCenterPreferenceDrafts(
  centers: Center[],
  preferences: ProviderPreferences,
): CenterPreferenceDraft[] {
  const drafts = centers.map((center) => {
    const preference = preferences.center_preferences.find((item) => {
      const centerMatches = item.center_id === center.id;
      return centerMatches;
    });
    const preferenceLevel = (preference?.preference_level ?? 0) as PreferenceLevel;
    const draft = {
      centerId: center.id,
      preferenceLevel,
    };
    return draft;
  });
  return drafts;
}

function createShiftTypePreferenceDrafts(
  preferences: ProviderPreferences,
): ShiftTypePreferenceDraft[] {
  const drafts = shiftTypes.map((shiftType) => {
    const preference = preferences.shift_type_preferences.find((item) => {
      const shiftTypeMatches = item.shift_type === shiftType;
      return shiftTypeMatches;
    });
    const preferenceLevel = (preference?.preference_level ?? 0) as PreferenceLevel;
    const draft = {
      shiftType,
      preferenceLevel,
    };
    return draft;
  });
  return drafts;
}

function createManagerPreferenceDrafts(
  centers: Center[],
  preferences: ManagerProviderPreferences,
): ManagerCenterPreferenceDraft[] {
  const drafts = centers.map((center) => {
    const preference = preferences.center_preferences.find((item) => {
      const centerMatches = item.center_id === center.id;
      return centerMatches;
    });
    const preferenceLevel = (preference?.preference_level ?? 0) as PreferenceLevel;
    const draft = {
      centerId: center.id,
      preferenceLevel,
      managerNote: preference?.manager_note ?? "",
    };
    return draft;
  });
  return drafts;
}

function visiblePreferencePayload(
  centerDrafts: CenterPreferenceDraft[],
  shiftTypeDrafts: ShiftTypePreferenceDraft[],
): ProviderPreferencesSavePayload {
  const centerPreferences = centerDrafts
    .filter((draft) => {
      const shouldPersist = draft.preferenceLevel !== 0;
      return shouldPersist;
    })
    .map((draft) => {
      const preference = {
        center_id: draft.centerId,
        preference_level: draft.preferenceLevel,
      };
      return preference;
    });
  const shiftTypePreferences = shiftTypeDrafts
    .filter((draft) => {
      const shouldPersist = draft.preferenceLevel !== 0;
      return shouldPersist;
    })
    .map((draft) => {
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

function managerPreferencePayload(
  drafts: ManagerCenterPreferenceDraft[],
): ManagerProviderPreferencesSavePayload {
  const centerPreferences = drafts
    .filter((draft) => {
      const hasPreference = draft.preferenceLevel !== 0;
      const hasNote = draft.managerNote.trim() !== "";
      const shouldPersist = hasPreference || hasNote;
      return shouldPersist;
    })
    .map((draft) => {
      const note = draft.managerNote.trim();
      const managerNote = note === "" ? null : note;
      const preference = {
        center_id: draft.centerId,
        preference_level: draft.preferenceLevel,
        manager_note: managerNote,
      };
      return preference;
    });
  const payload = {
    center_preferences: centerPreferences,
  };
  return payload;
}

function parsePreferenceLevel(value: string): PreferenceLevel {
  const numberValue = Number.parseInt(value, 10);
  const preferenceLevel = numberValue as PreferenceLevel;
  return preferenceLevel;
}

export function ProviderPreferencesEditor({
  centers,
  managerPreferences,
  preferences,
  provider,
}: ProviderPreferencesEditorProps) {
  const { showToast } = useToast();
  const router = useRouter();
  const initialCenterDrafts = useMemo(() => {
    const drafts = createCenterPreferenceDrafts(centers, preferences);
    return drafts;
  }, [centers, preferences]);
  const initialShiftTypeDrafts = useMemo(() => {
    const drafts = createShiftTypePreferenceDrafts(preferences);
    return drafts;
  }, [preferences]);
  const initialManagerDrafts = useMemo(() => {
    const drafts = createManagerPreferenceDrafts(centers, managerPreferences);
    return drafts;
  }, [centers, managerPreferences]);
  const [centerDrafts, setCenterDrafts] = useState(initialCenterDrafts);
  const [shiftTypeDrafts, setShiftTypeDrafts] = useState(initialShiftTypeDrafts);
  const [managerDrafts, setManagerDrafts] = useState(initialManagerDrafts);
  const [isSavingVisible, setIsSavingVisible] = useState(false);
  const [isSavingManager, setIsSavingManager] = useState(false);
  const [visibleMessage, setVisibleMessage] = useState<string | null>(null);
  const [managerMessage, setManagerMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function updateCenterDraft(
    centerId: string,
    changes: Partial<CenterPreferenceDraft>,
  ) {
    const nextDrafts = centerDrafts.map((draft) => {
      const centerMatches = draft.centerId === centerId;

      if (!centerMatches) {
        return draft;
      }

      const nextDraft = {
        ...draft,
        ...changes,
      };
      return nextDraft;
    });
    setCenterDrafts(nextDrafts);
  }

  function updateShiftTypeDraft(
    shiftType: ShiftTypeValue,
    changes: Partial<ShiftTypePreferenceDraft>,
  ) {
    const nextDrafts = shiftTypeDrafts.map((draft) => {
      const shiftTypeMatches = draft.shiftType === shiftType;

      if (!shiftTypeMatches) {
        return draft;
      }

      const nextDraft = {
        ...draft,
        ...changes,
      };
      return nextDraft;
    });
    setShiftTypeDrafts(nextDrafts);
  }

  function updateManagerDraft(
    centerId: string,
    changes: Partial<ManagerCenterPreferenceDraft>,
  ) {
    const nextDrafts = managerDrafts.map((draft) => {
      const centerMatches = draft.centerId === centerId;

      if (!centerMatches) {
        return draft;
      }

      const nextDraft = {
        ...draft,
        ...changes,
      };
      return nextDraft;
    });
    setManagerDrafts(nextDrafts);
  }

  async function saveVisiblePreferences() {
    setIsSavingVisible(true);
    setErrorMessage(null);
    setVisibleMessage(null);

    try {
      const payload = visiblePreferencePayload(centerDrafts, shiftTypeDrafts);
      await saveProviderPreferences(provider.id, payload);
      setVisibleMessage("Preferences saved.");
      showToast({
        title: "Preferences saved",
        description: "Provider-visible preferences were updated.",
        tone: "success",
      });
      router.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Preference save failed.";
      setErrorMessage(message);
      showToast({
        title: "Preference save failed",
        description: message,
        tone: "error",
      });
    } finally {
      setIsSavingVisible(false);
    }
  }

  async function saveManagerPreferences() {
    setIsSavingManager(true);
    setErrorMessage(null);
    setManagerMessage(null);

    try {
      const payload = managerPreferencePayload(managerDrafts);
      await saveManagerProviderPreferences(provider.id, payload);
      setManagerMessage("Manager preferences saved.");
      showToast({
        title: "Manager preferences saved",
        description: "Manager-only preferences were updated.",
        tone: "success",
      });
      router.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Manager preference save failed.";
      setErrorMessage(message);
      showToast({
        title: "Manager preference save failed",
        description: message,
        tone: "error",
      });
    } finally {
      setIsSavingManager(false);
    }
  }

  return (
    <div className="mt-6 grid gap-6 xl:grid-cols-2">
      {errorMessage ? (
        <div className="xl:col-span-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {errorMessage}
        </div>
      ) : null}

      <section className="rounded-md border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Practitioner Preferences</h2>
            <p className="mt-1 text-sm text-slate-600">{provider.display_name}</p>
          </div>
          {visibleMessage ? (
            <span className="rounded-md bg-emerald-100 px-3 py-1 text-sm font-semibold text-emerald-800">
              {visibleMessage}
            </span>
          ) : null}
        </div>

        <div className="mt-5 space-y-5">
          <div>
            <h3 className="text-sm font-semibold uppercase text-slate-500">Centers</h3>
            <div className="mt-3 divide-y divide-slate-100 rounded-md border border-slate-200">
              {centerDrafts.map((draft) => {
                const center = centers.find((item) => {
                  const centerMatches = item.id === draft.centerId;
                  return centerMatches;
                });
                const centerName = center?.name ?? "Unknown center";
                const badgeClassName = levelBadgeClassName(draft.preferenceLevel);

                return (
                  <div
                    key={draft.centerId}
                    className="grid gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_180px]"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-slate-950">{centerName}</p>
                      <span className={`mt-2 inline-flex rounded-md px-2 py-1 text-xs font-semibold ${badgeClassName}`}>
                        {labelForPreferenceLevel(draft.preferenceLevel)}
                      </span>
                    </div>
                    <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
                      Level
                      <select
                        className="h-10 rounded-md border border-slate-300 bg-white px-3 text-slate-950"
                        value={draft.preferenceLevel}
                        onChange={(event) => {
                          const preferenceLevel = parsePreferenceLevel(event.target.value);
                          updateCenterDraft(draft.centerId, { preferenceLevel });
                        }}
                      >
                        {preferenceLevels.map((level) => {
                          return (
                            <option key={level} value={level}>
                              {labelForPreferenceLevel(level)}
                            </option>
                          );
                        })}
                      </select>
                    </label>
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold uppercase text-slate-500">Shift Types</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {shiftTypeDrafts.map((draft) => {
                const badgeClassName = levelBadgeClassName(draft.preferenceLevel);

                return (
                  <div key={draft.shiftType} className="rounded-md border border-slate-200 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-medium text-slate-950">{labelForToken(draft.shiftType)}</p>
                      <span className={`rounded-md px-2 py-1 text-xs font-semibold ${badgeClassName}`}>
                        {labelForPreferenceLevel(draft.preferenceLevel)}
                      </span>
                    </div>
                    <label className="mt-3 flex flex-col gap-1 text-sm font-medium text-slate-700">
                      Level
                      <select
                        className="h-10 rounded-md border border-slate-300 bg-white px-3 text-slate-950"
                        value={draft.preferenceLevel}
                        onChange={(event) => {
                          const preferenceLevel = parsePreferenceLevel(event.target.value);
                          updateShiftTypeDraft(draft.shiftType, { preferenceLevel });
                        }}
                      >
                        {preferenceLevels.map((level) => {
                          return (
                            <option key={level} value={level}>
                              {labelForPreferenceLevel(level)}
                            </option>
                          );
                        })}
                      </select>
                    </label>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <button
          className="mt-5 inline-flex h-10 items-center justify-center rounded-md bg-teal-700 px-4 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
          type="button"
          disabled={isSavingVisible}
          onClick={saveVisiblePreferences}
        >
          {isSavingVisible ? "Saving..." : "Save practitioner preferences"}
        </button>
      </section>

      <section className="rounded-md border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Manager Preferences</h2>
            <p className="mt-1 text-sm text-slate-600">{provider.display_name}</p>
          </div>
          {managerMessage ? (
            <span className="rounded-md bg-emerald-100 px-3 py-1 text-sm font-semibold text-emerald-800">
              {managerMessage}
            </span>
          ) : null}
        </div>

        <div className="mt-5 divide-y divide-slate-100 rounded-md border border-slate-200">
          {managerDrafts.map((draft) => {
            const center = centers.find((item) => {
              const centerMatches = item.id === draft.centerId;
              return centerMatches;
            });
            const centerName = center?.name ?? "Unknown center";
            const badgeClassName = levelBadgeClassName(draft.preferenceLevel);

            return (
              <div
                key={draft.centerId}
                className="grid gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_180px]"
              >
                <div className="min-w-0">
                  <p className="font-medium text-slate-950">{centerName}</p>
                  <span className={`mt-2 inline-flex rounded-md px-2 py-1 text-xs font-semibold ${badgeClassName}`}>
                    {labelForPreferenceLevel(draft.preferenceLevel)}
                  </span>
                </div>
                <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
                  Level
                  <select
                    className="h-10 rounded-md border border-slate-300 bg-white px-3 text-slate-950"
                    value={draft.preferenceLevel}
                    onChange={(event) => {
                      const preferenceLevel = parsePreferenceLevel(event.target.value);
                      updateManagerDraft(draft.centerId, { preferenceLevel });
                    }}
                  >
                    {preferenceLevels.map((level) => {
                      return (
                        <option key={level} value={level}>
                          {labelForPreferenceLevel(level)}
                        </option>
                      );
                    })}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm font-medium text-slate-700 lg:col-span-2">
                  Note
                  <textarea
                    className="min-h-20 rounded-md border border-slate-300 px-3 py-2 text-slate-950"
                    value={draft.managerNote}
                    onChange={(event) => {
                      updateManagerDraft(draft.centerId, {
                        managerNote: event.target.value,
                      });
                    }}
                  />
                </label>
              </div>
            );
          })}
        </div>

        <button
          className="mt-5 inline-flex h-10 items-center justify-center rounded-md bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          type="button"
          disabled={isSavingManager}
          onClick={saveManagerPreferences}
        >
          {isSavingManager ? "Saving..." : "Save manager preferences"}
        </button>
      </section>
    </div>
  );
}
