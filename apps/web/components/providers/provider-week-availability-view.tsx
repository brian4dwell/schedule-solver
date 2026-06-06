import type { WeekAvailabilityViewProps } from "./provider-portal-types";
import { ShiftRequestControls } from "./provider-shift-request-controls";
import {
  availabilityOptions,
  labelFromSnake,
  weekdayOrder,
} from "./provider-portal-utils";

export function WeekAvailabilityView({
  availabilityMessage,
  isSavingAvailability,
  onDayChange,
  onSave,
  onShiftRequestChange,
  record,
}: WeekAvailabilityViewProps) {
  return (
    <section className="rounded-md border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-950">
            {record?.scheduleWeekName ?? "Availability"}
          </h2>
          <p className="mt-1 text-sm text-slate-600">Availability by Week</p>
        </div>
        {record !== null ? (
          <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
            {record.completion.isComplete ? "Complete" : "Incomplete"}
          </span>
        ) : null}
      </div>
      {availabilityMessage ? (
        <p className="mt-3 text-sm text-slate-600">{availabilityMessage}</p>
      ) : null}
      <p className="mt-3 max-w-3xl text-sm text-slate-600">
        Use this view to review one open week at a time. Select the shift options you can work for
        each day, then save the week when the entries and requested shift count look right.
      </p>
      {record !== null ? (
        <div className="mt-4 grid gap-3">
          <ShiftRequestControls
            maxShiftsRequested={record.availability.maxShiftsRequested}
            minShiftsRequested={record.availability.minShiftsRequested}
            onChange={onShiftRequestChange}
          />
          {weekdayOrder.map((weekday) => {
            const day = record.availability.days.find((candidate) => {
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
                          onChange={(event) => onDayChange(weekday, option, event.target.checked)}
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
            onClick={onSave}
          >
            {isSavingAvailability ? "Saving..." : "Save availability"}
          </button>
        </div>
      ) : (
        <p className="mt-4 text-sm text-slate-500">No open availability weeks.</p>
      )}
    </section>
  );
}
