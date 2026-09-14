import { scheduleAssignmentSavePayloadSchema } from "@/lib/schemas/schedule";
import { type ScheduleRoomAssignment } from "@/lib/schemas/schedule";
import { wallClockSchema } from "@/lib/schemas/schedule-time";

export function assignmentSavePayload(assignment: ScheduleRoomAssignment) {
  const payload = scheduleAssignmentSavePayloadSchema.parse({
    room_slot_id: assignment.id,
    allow_slot_date_change: assignment.slotDateChanged,
    provider_id: assignment.providerId,
    center_id: assignment.centerId,
    room_id: assignment.roomId,
    shift_requirement_id: assignment.shiftRequirementId,
    required_provider_type: assignment.requiredProviderType,
    shift_type: assignment.shiftType,
    schedule_date: assignment.slotDate,
    start_time: assignment.startTime,
    end_time: assignment.endTime,
    source: assignment.source,
    notes: assignment.notes,
  });
  return payload;
}

export function formatScheduleClock(value: string): string {
  const clock = wallClockSchema.parse(value);
  const hourText = clock.slice(0, 2);
  const hour = Number(hourText);
  const minute = clock.slice(3, 5);
  const period = hour < 12 ? "AM" : "PM";
  const displayHour = hour % 12 || 12;
  const label = `${displayHour}:${minute} ${period}`;
  return label;
}

export function providerHasTimeConflict(
  assignments: ScheduleRoomAssignment[],
  assignment: ScheduleRoomAssignment,
  providerId: string,
): boolean {
  const sameDayAssignments = assignments.filter((candidate) => {
    const otherSlot = candidate.id !== assignment.id;
    const sameProvider = candidate.providerId === providerId;
    const sameDate = candidate.slotDate === assignment.slotDate;
    return otherSlot && sameProvider && sameDate;
  });

  if (sameDayAssignments.length > 1) {
    return true;
  }

  return sameDayAssignments.some((candidate) => {
    const sameCenter = candidate.centerId === assignment.centerId;
    const firstThenSecond = assignment.shiftType === "first_half" && candidate.shiftType === "second_half";
    const secondThenFirst = assignment.shiftType === "second_half" && candidate.shiftType === "first_half";
    const splitPair = firstThenSecond || secondThenFirst;
    const startsBeforeEnd = assignment.startTime < candidate.endTime;
    const endsAfterStart = assignment.endTime > candidate.startTime;
    const overlaps = startsBeforeEnd && endsAfterStart;
    return !sameCenter || !splitPair || overlaps;
  });
}
