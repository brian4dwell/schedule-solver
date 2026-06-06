import type { PreferencesViewProps } from "./provider-portal-types";
import { labelFromSnake } from "./provider-portal-utils";

function labelForPreferenceLevel(value: number) {
  if (value === 3) {
    return "Strong prefer";
  }

  if (value === 2) {
    return "Prefer";
  }

  if (value === 1) {
    return "Slightly prefer";
  }

  if (value === -1) {
    return "Slightly avoid";
  }

  if (value === -2) {
    return "Prefer not";
  }

  if (value === -3) {
    return "Avoid";
  }

  return "Neutral";
}

function badgeClassNameForPreferenceLevel(value: number) {
  if (value > 0) {
    return "bg-emerald-100 text-emerald-800";
  }

  if (value < 0) {
    return "bg-amber-100 text-amber-800";
  }

  return "bg-slate-100 text-slate-700";
}

type PreferenceSliderProps = {
  label: string;
  onChange: (preferenceLevel: number) => void;
  preferenceLevel: number;
};

function PreferenceSlider({
  label,
  onChange,
  preferenceLevel,
}: PreferenceSliderProps) {
  const preferenceLabel = labelForPreferenceLevel(preferenceLevel);
  const badgeClassName = badgeClassNameForPreferenceLevel(preferenceLevel);

  return (
    <div className="rounded-md border border-slate-200 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm font-medium text-slate-700">{label}</span>
        <span className={`rounded-md px-2 py-1 text-xs font-semibold ${badgeClassName}`}>
          {preferenceLabel}
        </span>
      </div>
      <label className="mt-3 block">
        <span className="sr-only">{label} preference</span>
        <input
          className="w-full accent-teal-700"
          type="range"
          min={-3}
          max={3}
          step={1}
          value={preferenceLevel}
          onChange={(event) => {
            const nextPreferenceLevel = Number.parseInt(event.target.value, 10);
            onChange(nextPreferenceLevel);
          }}
        />
      </label>
      <div className="mt-1 flex justify-between text-xs font-medium text-slate-500">
        <span>Avoid</span>
        <span>Neutral</span>
        <span>Prefer</span>
      </div>
    </div>
  );
}

export function PreferencesView({
  centerDrafts,
  isSavingPreferences,
  onCenterDraftsChange,
  onSave,
  onShiftTypeDraftsChange,
  preferenceMessage,
  shiftTypeDrafts,
}: PreferencesViewProps) {
  return (
    <section className="rounded-md border border-slate-200 bg-white p-4">
      <h2 className="text-base font-semibold text-slate-950">Preferences</h2>
      <p className="mt-2 max-w-3xl text-sm text-slate-600">
        These optional preferences help the scheduler choose between otherwise valid assignments.
        Availability, credentials, coverage needs, and published rules still come first. Leave a
        slider centered when you do not have a preference.
      </p>
      {preferenceMessage ? (
        <p className="mt-3 text-sm text-slate-600">{preferenceMessage}</p>
      ) : null}
      <div className="mt-4 space-y-5">
        <div>
          <h3 className="text-sm font-semibold uppercase text-slate-500">
            Center-based preferences
          </h3>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {centerDrafts.map((draft, index) => {
              return (
                <PreferenceSlider
                  key={draft.centerId}
                  label={draft.name}
                  preferenceLevel={draft.preferenceLevel}
                  onChange={(preferenceLevel) => {
                    const nextDrafts = [...centerDrafts];
                    nextDrafts[index] = {
                      ...draft,
                      preferenceLevel,
                    };
                    onCenterDraftsChange(nextDrafts);
                  }}
                />
              );
            })}
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold uppercase text-slate-500">
            Shift-based preferences
          </h3>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {shiftTypeDrafts.map((draft, index) => {
              const shiftTypeLabel = labelFromSnake(draft.shiftType);
              return (
                <PreferenceSlider
                  key={draft.shiftType}
                  label={shiftTypeLabel}
                  preferenceLevel={draft.preferenceLevel}
                  onChange={(preferenceLevel) => {
                    const nextDrafts = [...shiftTypeDrafts];
                    nextDrafts[index] = {
                      ...draft,
                      preferenceLevel,
                    };
                    onShiftTypeDraftsChange(nextDrafts);
                  }}
                />
              );
            })}
          </div>
        </div>
      </div>
      <button
        type="button"
        className="mt-4 rounded-md bg-teal-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        disabled={isSavingPreferences}
        onClick={onSave}
      >
        {isSavingPreferences ? "Saving..." : "Save preferences"}
      </button>
    </section>
  );
}
