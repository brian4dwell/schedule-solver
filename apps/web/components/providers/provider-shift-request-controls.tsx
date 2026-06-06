import type { ShiftRequestControlsProps } from "./provider-portal-types";

export function ShiftRequestControls({
  maxShiftsRequested,
  minShiftsRequested,
  onChange,
}: ShiftRequestControlsProps) {
  return (
    <div>
      <p className="mb-3 max-w-3xl text-sm text-slate-600">
        Use min and max shifts to tell the scheduler how many assignments you want this week.
        These requests are considered after availability and coverage needs.
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex items-center justify-between gap-3 rounded-md border border-slate-200 p-3">
          <span className="text-sm font-medium text-slate-700">Min shifts requested</span>
          <input
            className="w-24 rounded-md border border-slate-300 px-3 py-2 text-sm"
            type="number"
            min={0}
            step={0.5}
            value={minShiftsRequested}
            onChange={(event) => onChange("min", event.target.value)}
          />
        </label>
        <label className="flex items-center justify-between gap-3 rounded-md border border-slate-200 p-3">
          <span className="text-sm font-medium text-slate-700">Max shifts requested</span>
          <input
            className="w-24 rounded-md border border-slate-300 px-3 py-2 text-sm"
            type="number"
            min={0}
            step={0.5}
            value={maxShiftsRequested}
            onChange={(event) => onChange("max", event.target.value)}
          />
        </label>
      </div>
    </div>
  );
}
