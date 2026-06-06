import type { ProviderPortalSidebarProps } from "./provider-portal-types";
import { providerPortalNavigationItems } from "./provider-portal-utils";

export function ProviderPortalSidebar({
  activeSection,
  completionText,
  onSectionChange,
  onWeekSelect,
  profile,
  records,
  selectedWeekId,
}: ProviderPortalSidebarProps) {
  return (
    <aside className="rounded-md border border-slate-200 bg-white p-4">
      <div className="text-sm text-slate-500">Signed in as</div>
      <div className="mt-1 text-lg font-semibold text-slate-950">{profile.display_name}</div>
      <div className="text-sm text-slate-600">{profile.email ?? "No email on file"}</div>
      <div className="mt-4 rounded-md border border-slate-200 p-3">
        <div className="text-sm font-semibold text-slate-950">{completionText}</div>
        <div className="mt-1 text-xs text-slate-500">
          {records.length} availability weeks
        </div>
      </div>
      <nav className="mt-4 grid gap-2" aria-label="Provider Portal sections">
        {providerPortalNavigationItems.map((item) => {
          const itemIsActive = item.id === activeSection;
          const activeClass = "border-slate-950 bg-slate-950 text-white";
          const inactiveClass = "border-slate-200 bg-white text-slate-700 hover:border-teal-700";
          const stateClass = itemIsActive ? activeClass : inactiveClass;
          const buttonClass = `rounded-md border px-3 py-2 text-left text-sm font-semibold ${stateClass}`;

          return (
            <button
              key={item.id}
              type="button"
              className={buttonClass}
              onClick={() => onSectionChange(item.id)}
            >
              {item.label}
            </button>
          );
        })}
      </nav>
      {activeSection === "weekAvailability" ? (
        <div className="mt-5 border-t border-slate-200 pt-4">
          <div className="text-xs font-semibold uppercase text-slate-500">Availability weeks</div>
          <div className="mt-3 grid gap-2">
            {records.map((record) => {
              const isSelected = record.scheduleWeekId === selectedWeekId;
              const selectedClass = isSelected ? "border-teal-700 bg-teal-50" : "border-slate-200 bg-white";
              const completeClass = record.completion.isComplete ? "text-emerald-700" : "text-amber-800";
              return (
                <button
                  key={record.scheduleWeekId}
                  type="button"
                  className={`rounded-md border p-3 text-left ${selectedClass}`}
                  onClick={() => onWeekSelect(record.scheduleWeekId)}
                >
                  <div className="text-sm font-semibold text-slate-950">{record.scheduleWeekName}</div>
                  <div className={`mt-1 text-xs font-medium ${completeClass}`}>
                    {record.completion.isComplete ? "Complete" : "Incomplete"}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </aside>
  );
}
