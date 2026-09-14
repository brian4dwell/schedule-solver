import { useId } from "react";

import {
  providerWeeklyNotesSchema,
  weeklyNotesCharacterCount,
  weeklyNotesMaxLength,
} from "@/lib/schemas/provider-weekly-availability";

type ProviderWeekNotesFieldProps = {
  notes: string | null;
  startDate: string;
  endDate: string;
  disabled: boolean;
  isDirty: boolean;
  onChange: (value: string) => void;
};

export function ProviderWeekNotesField({
  notes,
  startDate,
  endDate,
  disabled,
  isDirty,
  onChange,
}: ProviderWeekNotesFieldProps) {
  const fieldId = useId();
  const descriptionId = `${fieldId}-description`;
  const text = notes === null ? "" : notes;
  const characterCount = weeklyNotesCharacterCount(text);
  const validation = providerWeeklyNotesSchema.safeParse(notes);
  const hasError = !validation.success;

  return (
    <div className="grid gap-2 text-sm text-slate-700">
      <label className="font-semibold" htmlFor={fieldId}>
        Notes for this week <span className="font-normal">({startDate} – {endDate})</span>
      </label>
      <textarea
        id={fieldId}
        aria-describedby={descriptionId}
        aria-invalid={hasError}
        className="w-full resize-y rounded-md border border-slate-300 bg-white p-2 text-sm disabled:bg-slate-50"
        rows={3}
        disabled={disabled}
        value={text}
        onChange={(event) => onChange(event.target.value)}
      />
      <div id={descriptionId} className={hasError ? "text-red-700" : "text-xs text-slate-500"}>
        {hasError ? "Notes must be 2,000 characters or fewer." : `${characterCount} / ${weeklyNotesMaxLength} characters. Optional context for your scheduler.`}
        {isDirty ? <span className="ml-2 text-amber-800">Unsaved note changes</span> : null}
      </div>
    </div>
  );
}
