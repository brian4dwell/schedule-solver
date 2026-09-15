"use client";

import { useEffect, useRef, useState } from "react";

import { useToast } from "@/components/ui/toast-provider";
import { getShiftBackupProviderReport, getShiftBackupReportOptions } from "@/lib/api";
import { backupReportDateRangeSchema } from "@/lib/schemas/reports";
import type { BackupReportCandidate, BackupReportOptions, BackupReportRequest, ShiftBackupProviderReport } from "@/lib/schemas/reports";

type PeriodSelection = {
  periodId: string;
  choice: string;
};

function versionLabel(report: ShiftBackupProviderReport, versionId: string): string {
  const version = report.selected_versions.find((item) => item.id === versionId);
  if (version === undefined) {
    throw new Error("Report source version is missing.");
  }
  return `${version.period_name} · v${version.version_number} · ${version.status}`;
}

function CandidateRow({ candidate, report }: { candidate: BackupReportCandidate; report: ShiftBackupProviderReport }) {
  const hasConflicts = candidate.conflicts.length > 0;
  const label = hasConflicts ? "Qualified but already scheduled" : "Available replacement";

  return (
    <tr className="border-t border-slate-200 align-top">
      <td className="w-1/3 p-3 font-medium [overflow-wrap:anywhere]">{candidate.display_name}</td>
      <td className="p-3 [overflow-wrap:anywhere]">
        <p className="font-semibold">{label}</p>
        {candidate.warnings.map((warning) => (
          <p key={warning.constraint_type} className="mt-1 text-amber-900">Warning: {warning.message}</p>
        ))}
        {candidate.conflicts.map((conflict) => (
          <div key={conflict.shift.assignment_id} className="mt-2 border-l-2 border-slate-300 pl-3">
            <p>{conflict.shift.schedule_date} · {conflict.shift.start_time}–{conflict.shift.end_time} · {conflict.shift.timezone}</p>
            <p>{conflict.shift.center_name} · {conflict.shift.room_name} · {conflict.shift.shift_type.replaceAll("_", " ")}</p>
            <p className="text-xs text-slate-600">{versionLabel(report, conflict.shift.schedule_version_id)}</p>
            {conflict.violations.map((violation) => <p key={violation.constraint_type}>{violation.message}</p>)}
          </div>
        ))}
      </td>
    </tr>
  );
}

export function ShiftBackupReportResults({ report }: { report: ShiftBackupProviderReport }) {
  const centerLabel = report.center === null ? "All Centers" : report.center.name;
  const generationLabel = report.generated_at.replace("T", " ");

  return (
    <section className="shift-backup-results space-y-4">
      <header className="space-y-2 text-sm">
        <h2 className="text-xl font-semibold">Shift Backup Provider Report</h2>
        <p className="font-medium">{report.start_date} – {report.end_date} · {centerLabel} · {report.shifts.length} shifts</p>
        <p>Generated {generationLabel}. Uses current saved availability, Center credentials, Provider types, and Room Type skills. This does not reconstruct eligibility at publication or verify a separate licensing registry.</p>
        <p>Available replacements are conflict-free within the selected versions below. All Centers in these versions participate in conflict checks. Excluded periods do not participate.</p>
        <div>
          <h3 className="font-semibold">Selected versions</h3>
          {report.selected_versions.length === 0 ? <p>None</p> : null}
          {report.selected_versions.map((version) => (
            <p key={version.id}>{versionLabel(report, version.id)} · {version.start_date} – {version.end_date}</p>
          ))}
        </div>
        {report.excluded_periods.length > 0 ? (
          <div>
            <h3 className="font-semibold">Explicitly excluded periods</h3>
            {report.excluded_periods.map((period) => <p key={period.id}>{period.name} · {period.start_date} – {period.end_date}</p>)}
          </div>
        ) : null}
      </header>
      {report.shifts.length === 0 ? <p>No shifts match the selected dates, Center, and versions.</p> : null}
      {report.shifts.map((shift) => {
        const hasBlockers = shift.blockers.length > 0;
        const isUnassigned = shift.assigned_provider_id === null;
        const assignedLabel = isUnassigned ? "Unassigned" : shift.assigned_provider_name;
        const roomLabel = shift.room_id === null ? "No room" : shift.room_name;
        const shiftLabel = shift.shift_type.replaceAll("_", " ");
        const hasAvailable = shift.available_replacements.length > 0;

        return (
          <table key={shift.assignment_id} className="shift-backup-shift w-full table-fixed border border-slate-300 bg-white text-left text-sm">
            <thead className="bg-slate-100">
              <tr>
                <th colSpan={2} className="p-3 font-normal [overflow-wrap:anywhere]">
                  <p className="font-semibold">{shift.schedule_date} · {shift.start_time}–{shift.end_time} · {shift.timezone}</p>
                  <p>{shift.center_name} · {roomLabel} · {shiftLabel}</p>
                  <p>Assigned Provider: <strong>{assignedLabel}</strong></p>
                  <p className="mt-1 text-xs">{versionLabel(report, shift.schedule_version_id)}</p>
                </th>
              </tr>
              <tr className="border-t border-slate-200">
                <th scope="col" className="w-1/3 px-3 py-2">Provider</th>
                <th scope="col" className="px-3 py-2">Replacement assessment</th>
              </tr>
            </thead>
            <tbody>
              {hasBlockers ? (
                <tr><td colSpan={2} className="p-3 text-red-800">
                  <p className="font-semibold">Cannot evaluate replacements — shift data is blocked.</p>
                  {shift.blockers.map((blocker) => <p key={blocker.constraint_type}>Blocker: {blocker.message}</p>)}
                </td></tr>
              ) : null}
              {!hasBlockers && !hasAvailable ? <tr><td colSpan={2} className="p-3 font-medium">No eligible replacements</td></tr> : null}
              {shift.available_replacements.map((candidate) => <CandidateRow key={candidate.provider_id} candidate={candidate} report={report} />)}
              {shift.qualified_but_scheduled.map((candidate) => <CandidateRow key={candidate.provider_id} candidate={candidate} report={report} />)}
            </tbody>
          </table>
        );
      })}
    </section>
  );
}

export function ShiftBackupProviderReportWorkspace() {
  const { showToast } = useToast();
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [centerId, setCenterId] = useState("");
  const [options, setOptions] = useState<BackupReportOptions | null>(null);
  const [selections, setSelections] = useState<PeriodSelection[]>([]);
  const [report, setReport] = useState<ShiftBackupProviderReport | null>(null);
  const [pending, setPending] = useState<"options" | "report" | null>(null);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const allResolved = selections.every((selection) => selection.choice !== "");
  const canGenerate = options !== null && allResolved && pending === null;

  useEffect(() => {
    return () => {
      requestSequence.current += 1;
    };
  }, []);

  function invalidateReport() {
    requestSequence.current += 1;
    setReport(null);
    setPending(null);
  }

  function updateDates(value: string, field: "start" | "end") {
    invalidateReport();
    setOptions(null);
    setSelections([]);
    setValidationMessage(null);
    if (field === "start") {
      setStartDate(value);
    } else {
      setEndDate(value);
    }
  }

  async function loadOptions() {
    const parsed = backupReportDateRangeSchema.safeParse({ start_date: startDate, end_date: endDate });
    if (!parsed.success) {
      setValidationMessage("Enter valid dates with the end date on or after the start date.");
      return;
    }
    invalidateReport();
    setOptions(null);
    setSelections([]);
    setValidationMessage(null);
    setPending("options");
    const sequence = requestSequence.current;
    try {
      const nextOptions = await getShiftBackupReportOptions(parsed.data);
      if (sequence !== requestSequence.current) {
        return;
      }
      const nextSelections = nextOptions.periods.map((period) => ({ periodId: period.id, choice: "" }));
      setOptions(nextOptions);
      setSelections(nextSelections);
      setCenterId("");
    } catch (error) {
      if (sequence === requestSequence.current) {
        const description = error instanceof Error ? error.message : String(error);
        showToast({ title: "Unable to load schedule choices", description, tone: "error" });
      }
    } finally {
      if (sequence === requestSequence.current) {
        setPending(null);
      }
    }
  }

  function updateSelection(periodId: string, choice: string) {
    invalidateReport();
    const nextSelections = selections.map((selection) => {
      if (selection.periodId === periodId) {
        return { periodId, choice };
      }
      return selection;
    });
    setSelections(nextSelections);
  }

  async function generateReport() {
    if (!canGenerate) {
      return;
    }
    invalidateReport();
    setPending("report");
    const sequence = requestSequence.current;
    const included = selections.filter((selection) => selection.choice !== "exclude");
    const excluded = selections.filter((selection) => selection.choice === "exclude");
    const selectedVersionIds = included.map((selection) => selection.choice);
    const excludedPeriodIds = excluded.map((selection) => selection.periodId);
    const request: BackupReportRequest = {
      start_date: startDate,
      end_date: endDate,
      center_id: centerId === "" ? null : centerId,
      selected_version_ids: selectedVersionIds,
      excluded_period_ids: excludedPeriodIds,
    };
    try {
      const nextReport = await getShiftBackupProviderReport(request);
      if (sequence === requestSequence.current) {
        setReport(nextReport);
      }
    } catch (error) {
      if (sequence === requestSequence.current) {
        const description = error instanceof Error ? error.message : String(error);
        showToast({ title: "Unable to generate backup report", description, tone: "error" });
      }
    } finally {
      if (sequence === requestSequence.current) {
        setPending(null);
      }
    }
  }

  return (
    <div className="shift-backup-report space-y-5">
      <section className="shift-backup-screen-only space-y-4 rounded-md border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-end gap-4">
          <label className="space-y-1 text-sm font-medium">
            <span className="block">Start date</span>
            <input type="date" value={startDate} onChange={(event) => updateDates(event.target.value, "start")} className="rounded-md border border-slate-300 px-3 py-2" />
          </label>
          <label className="space-y-1 text-sm font-medium">
            <span className="block">End date</span>
            <input type="date" value={endDate} onChange={(event) => updateDates(event.target.value, "end")} className="rounded-md border border-slate-300 px-3 py-2" />
          </label>
          <button type="button" onClick={loadOptions} disabled={pending === "options"} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold disabled:opacity-50">Load schedule choices</button>
        </div>
        {validationMessage !== null ? <p className="text-sm text-red-700">{validationMessage}</p> : null}
        {options !== null ? (
          <>
            <p className="text-sm text-slate-600">Choose one version or explicitly exclude each period. Selecting overlapping periods treats them as concurrent work; exclude alternative schedules. Neighboring periods from {options.context_start_date} through {options.context_end_date} are included for timezone conflict checks.</p>
            {options.periods.length === 0 ? <p className="text-sm">No schedule periods in this date range.</p> : null}
            <div className="grid gap-3 lg:grid-cols-2">
              {options.periods.map((period) => {
                const selection = selections.find((item) => item.periodId === period.id);
                return (
                  <label key={period.id} className="space-y-1 text-sm">
                    <span className="block font-medium">{period.name} · {period.start_date} – {period.end_date}</span>
                    <select value={selection?.choice} onChange={(event) => updateSelection(period.id, event.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2">
                      <option value="">Choose version or exclusion</option>
                      <option value="exclude">Exclude this period from the report and conflict checks</option>
                      {period.versions.map((version) => <option key={version.id} value={version.id}>Version {version.version_number} · {version.status}</option>)}
                    </select>
                  </label>
                );
              })}
            </div>
            <label className="block space-y-1 text-sm font-medium">
              <span className="block">Center (shift rows only)</span>
              <select value={centerId} onChange={(event) => { invalidateReport(); setCenterId(event.target.value); }} className="rounded-md border border-slate-300 px-3 py-2">
                <option value="">All Centers</option>
                {options.centers.map((center) => <option key={center.id} value={center.id}>{center.name}{center.is_active ? "" : " · Inactive"}</option>)}
              </select>
            </label>
            {!allResolved ? <p className="text-sm text-amber-800">Resolve every schedule period before generating.</p> : null}
            <div className="flex gap-3">
              <button type="button" disabled={!canGenerate} onClick={generateReport} className="rounded-md bg-teal-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Generate report</button>
              <button type="button" disabled={report === null || pending !== null} onClick={() => window.print()} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold disabled:opacity-50">Print / Save as PDF</button>
            </div>
          </>
        ) : null}
        {pending !== null ? <p role="status" className="text-sm text-slate-600">{pending === "options" ? "Loading schedule choices..." : "Evaluating replacements..."}</p> : null}
      </section>
      {report !== null ? <ShiftBackupReportResults report={report} /> : null}
    </div>
  );
}
