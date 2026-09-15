import { randomUUID } from "node:crypto";

export function backupFixture(candidateCount = 1) {
  const periodId = randomUUID();
  const versionId = randomUUID();
  const centerId = randomUUID();
  const center = { id: centerId, name: "Central Surgery", timezone: "America/New_York", is_active: true };
  const version = { id: versionId, version_number: 2, status: "published" };
  const options = {
    start_date: "2026-09-14", end_date: "2026-09-20",
    context_start_date: "2026-09-12", context_end_date: "2026-09-22",
    centers: [center],
    periods: [{ id: periodId, name: "September schedule", start_date: "2026-09-14", end_date: "2026-09-20", versions: [version] }],
  };
  const report = {
    start_date: "2026-09-14", end_date: "2026-09-20", generated_at: "2026-09-14T13:30:00Z", center: null,
    selected_versions: [{ ...version, schedule_period_id: periodId, period_name: "September schedule", start_date: "2026-09-14", end_date: "2026-09-20" }],
    excluded_periods: [],
    shifts: [{
      assignment_id: randomUUID(), schedule_period_id: periodId, schedule_version_id: versionId,
      schedule_date: "2026-09-14", start_time: "07:00", end_time: "15:00",
      center_id: centerId, center_name: "Central Surgery", timezone: "America/New_York",
      room_id: null, room_name: null, shift_type: "full_shift",
      assigned_provider_id: null, assigned_provider_name: null, blockers: [],
      available_replacements: Array.from({ length: candidateCount }, (_value, index) => ({
        provider_id: randomUUID(), display_name: `Replacement Provider ${index + 1}`,
        warnings: [{ severity: "warning", constraint_type: "provider_max_shifts_exceeded", category: "shift_request_conflict", message: "Provider is over the maximum requested shifts for this schedule week." }],
        conflicts: [],
      })),
      qualified_but_scheduled: [],
    }],
  };
  return { options, report };
}

export function addBookedCandidate(report) {
  const target = report.shifts[0];
  const shift = {
    assignment_id: randomUUID(), schedule_period_id: target.schedule_period_id, schedule_version_id: target.schedule_version_id,
    schedule_date: "2026-09-14", start_time: "08:00", end_time: "16:00",
    center_id: randomUUID(), center_name: "West Center", timezone: "America/Chicago",
    room_id: null, room_name: null, shift_type: "full_shift",
  };
  target.qualified_but_scheduled.push({
    provider_id: randomUUID(), display_name: "Booked Provider", warnings: [],
    conflicts: [{ shift, violations: [{ severity: "hard_violation", constraint_type: "provider_double_booked", category: "other_hard_constraint", message: "Provider is already assigned to an overlapping slot." }] }],
  });
}
