"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  checkProviderSlotEligibility,
  generateScheduleVersion,
  getProviderWeeklyAvailability,
  publishScheduleVersion,
  saveDraftScheduleVersion,
  type Center,
  type Provider,
  type ProviderSlotEligibility,
  type ProviderWeeklyAvailabilityRecord,
  type Room,
  type ScheduleAssignmentSavePayload,
  type SchedulePeriod,
  type ScheduleVersionDetail,
} from "@/lib/api";
import type { AvailabilityOption } from "@/lib/schemas/provider-weekly-availability";
import type {
  ProviderIneligibilityReason,
  ScheduleDayKey,
  SchedulePublishEvent,
  ScheduleRoomAssignment,
  ScheduleVersion,
} from "@/lib/schemas/schedule";
import {
  schedulePublishEventSchema,
  scheduleVersionSchema,
} from "@/lib/schemas/schedule";

type RoomRow = {
  room: Room;
  center: Center;
};

type AvailableRoom = {
  id: string;
  centerId: string;
  centerName: string;
  name: string;
  mdOnly: boolean;
  roomTypeIds: string[];
  roomTypeNames: string[];
};

type DayColumn = {
  key: ScheduleDayKey;
  label: string;
  isWeekend: boolean;
};

type DraggedAssignment = {
  assignmentId: string;
  dayKey: ScheduleDayKey;
};

type DragPayload =
  | {
      type: "available-room";
      roomId: string;
    }
  | {
      type: "scheduled-room";
      assignmentId: string;
      dayKey: ScheduleDayKey;
    };

type ScheduleWorkspaceProps = {
  initialVersionDetail: ScheduleVersionDetail | null;
  providers: Provider[];
  rooms: RoomRow[];
  schedulePeriod: SchedulePeriod;
  scheduleId: string;
};

type ProviderPickerOption = {
  provider: Provider;
  isEligible: boolean;
  reasons: ProviderIneligibilityReason[];
  candidateShiftCount: number;
  minShiftsRequested: number;
  maxShiftsRequested: number;
  availabilityOptions: AvailabilityOption[];
};

type ConstraintSeverity = "Hard" | "Warning" | "Soft";

type ConstraintRow = {
  id: string;
  severity: ConstraintSeverity;
  scope: string;
  subject: string;
  constraint: string;
  message: string;
};

const dayColumns: DayColumn[] = [
  { key: "monday", label: "Monday", isWeekend: false },
  { key: "tuesday", label: "Tuesday", isWeekend: false },
  { key: "wednesday", label: "Wednesday", isWeekend: false },
  { key: "thursday", label: "Thursday", isWeekend: false },
  { key: "friday", label: "Friday", isWeekend: false },
  { key: "saturday", label: "Saturday", isWeekend: true },
  { key: "sunday", label: "Sunday", isWeekend: true },
];

function createAssignmentId() {
  const randomValue = crypto.randomUUID();
  return randomValue;
}

function createPublishEventId() {
  const randomValue = crypto.randomUUID();
  return randomValue;
}

function formatTimelineDate(value: string) {
  const date = new Date(value);
  const formatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const formattedValue = formatter.format(date);
  return formattedValue;
}

function createInitialVersion(schedulePeriod: SchedulePeriod): ScheduleVersion {
  const createdAt = new Date().toISOString();
  const version = {
    id: `${schedulePeriod.id}-working`,
    name: `${schedulePeriod.name} Working Version`,
    status: "working",
    createdAt,
    assignments: [],
  };
  const parsedVersion = scheduleVersionSchema.parse(version);
  return parsedVersion;
}

function dateAtUtcMidnight(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  return date;
}

function dayIndexForDayKey(dayKey: ScheduleDayKey) {
  const dayIndex = dayColumns.findIndex((column) => {
    return column.key === dayKey;
  });

  if (dayIndex === -1) {
    throw new Error("Schedule day key must resolve to a day index.");
  }

  return dayIndex;
}

function dayKeyForAssignment(
  schedulePeriod: SchedulePeriod,
  startTime: string,
): ScheduleDayKey {
  const periodStart = dateAtUtcMidnight(schedulePeriod.start_date);
  const periodStartWeekday = periodStart.getUTCDay();
  const assignmentDate = new Date(startTime);
  const assignmentWeekday = assignmentDate.getUTCDay();
  const weekdayOffset = (assignmentWeekday - periodStartWeekday + 7) % 7;
  const dayColumn = dayColumns[weekdayOffset];

  if (dayColumn === undefined) {
    throw new Error("Schedule weekday offset must resolve to a day column.");
  }

  const dayKey = dayColumn.key;
  return dayKey;
}

function timeLabelFromDateTime(value: string) {
  const date = new Date(value);
  const hour = date.getUTCHours().toString().padStart(2, "0");
  const minute = date.getUTCMinutes().toString().padStart(2, "0");
  const label = `${hour}:${minute}`;
  return label;
}

function dateForDayKey(schedulePeriod: SchedulePeriod, dayKey: ScheduleDayKey) {
  const periodStart = dateAtUtcMidnight(schedulePeriod.start_date);
  const periodStartWeekday = periodStart.getUTCDay();
  const targetDayIndex = dayIndexForDayKey(dayKey);
  const weekdayOffset = (targetDayIndex - periodStartWeekday + 7) % 7;
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  const dateTime = periodStart.getTime() + weekdayOffset * millisecondsPerDay;
  const date = new Date(dateTime);
  return date;
}

function dateTimeForAssignment(
  schedulePeriod: SchedulePeriod,
  dayKey: ScheduleDayKey,
  timeValue: string,
) {
  const date = dateForDayKey(schedulePeriod, dayKey);
  const timeParts = timeValue.split(":");
  const hour = Number(timeParts[0]);
  const minute = Number(timeParts[1]);
  date.setUTCHours(hour, minute, 0, 0);
  const value = date.toISOString();
  return value;
}

function versionFromDetail(
  schedulePeriod: SchedulePeriod,
  detail: ScheduleVersionDetail,
): ScheduleVersion {
  const assignments = detail.assignments.flatMap((assignment, index) => {
    if (assignment.room_id === null) {
      return [];
    }

    const violations = detail.violations.filter((violation) => {
      return violation.assignment_id === assignment.id;
    });
    const validationMessages = violations.map((violation) => {
      return violation.message;
    });
    const hasViolations = violations.length > 0;
    const validationStatus = hasViolations ? "invalid" : "valid";
    const roomAssignment = {
      id: assignment.id,
      dayKey: dayKeyForAssignment(schedulePeriod, assignment.start_time),
      centerId: assignment.center_id,
      roomId: assignment.room_id,
      shiftType: assignment.shift_type,
      providerId: assignment.provider_id,
      startTime: timeLabelFromDateTime(assignment.start_time),
      endTime: timeLabelFromDateTime(assignment.end_time),
      sortOrder: index,
      validationStatus,
      validationMessages,
    };
    return [roomAssignment];
  });
  const version = {
    id: detail.version.id,
    name: `${schedulePeriod.name} Version ${detail.version.version_number}`,
    status: detail.version.status,
    createdAt: detail.version.created_at,
    assignments,
  };
  const parsedVersion = scheduleVersionSchema.parse(version);
  return parsedVersion;
}

function publishEventsFromDetail(
  detail: ScheduleVersionDetail | null,
): SchedulePublishEvent[] {
  if (detail === null) {
    return [];
  }

  const publishedAt = detail.version.published_at;

  if (publishedAt === null) {
    return [];
  }

  const publishEvent = {
    id: `${detail.version.id}-published`,
    versionId: detail.version.id,
    publishedAt,
    summary: "Published saved schedule",
  };
  const parsedPublishEvent = schedulePublishEventSchema.parse(publishEvent);
  return [parsedPublishEvent];
}

function availableRoomsFromRows(rows: RoomRow[]): AvailableRoom[] {
  const availableRooms = rows
    .filter((row) => {
      return row.room.is_active;
    })
    .map((row) => {
      const room = {
        id: row.room.id,
        centerId: row.center.id,
        centerName: row.center.name,
        name: row.room.name,
        mdOnly: row.room.md_only,
        roomTypeIds: row.room.room_types.map((roomType) => {
          return roomType.id;
        }),
        roomTypeNames: row.room.room_types.map((roomType) => {
          return roomType.name;
        }),
      };
      return room;
    });
  return availableRooms;
}

function createProviderReason(
  code: string,
  category: ProviderIneligibilityReason["category"],
  message: string,
): ProviderIneligibilityReason {
  const reason = {
    code,
    category,
    message,
  };
  return reason;
}

function normalizedReasonCategory(
  category: string,
): ProviderIneligibilityReason["category"] {
  if (category === "missing_credential") {
    return "missing_credential";
  }

  if (category === "credential_inactive") {
    return "credential_inactive";
  }

  if (category === "missing_skill") {
    return "missing_skill";
  }

  if (category === "md_requirement_not_met") {
    return "md_requirement_not_met";
  }

  if (category === "availability_conflict") {
    return "availability_conflict";
  }

  if (category === "shift_request_conflict") {
    return "shift_request_conflict";
  }

  return "other_hard_constraint";
}

function reasonsFromBackendEligibility(
  response: ProviderSlotEligibility,
): ProviderIneligibilityReason[] {
  const hardViolations = response.violations.filter((violation) => {
    return violation.severity === "hard_violation";
  });
  const reasons = hardViolations.map((violation) => {
    const category = normalizedReasonCategory(violation.category);
    const reason = createProviderReason(
      violation.constraint_type,
      category,
      violation.message,
    );
    return reason;
  });
  return reasons;
}

function mergeProviderReasons(
  firstReasons: ProviderIneligibilityReason[],
  secondReasons: ProviderIneligibilityReason[],
) {
  const reasonByCode = new Map<string, ProviderIneligibilityReason>();

  for (const reason of firstReasons) {
    reasonByCode.set(reason.code, reason);
  }

  for (const reason of secondReasons) {
    reasonByCode.set(reason.code, reason);
  }

  const reasons = Array.from(reasonByCode.values());
  return reasons;
}

function availabilityOptionsForDay(
  availability: ProviderWeeklyAvailabilityRecord | undefined,
  dayKey: ScheduleDayKey,
): AvailabilityOption[] {
  if (availability === undefined) {
    return ["unset"];
  }

  const day = availability.days.find((candidate) => {
    return candidate.weekday === dayKey;
  });
  const options = day?.options ?? ["unset"];
  return options;
}

function assignedShiftCountForProvider(
  assignments: ScheduleRoomAssignment[],
  providerId: string,
) {
  const assignedShifts = assignments.filter((assignment) => {
    return assignment.providerId === providerId;
  });
  const assignedShiftCount = assignedShifts.length;
  return assignedShiftCount;
}

function candidateShiftCountForProvider(
  assignments: ScheduleRoomAssignment[],
  assignment: ScheduleRoomAssignment,
  providerId: string,
) {
  const otherAssignedShifts = assignments.filter((candidate) => {
    const isSameAssignment = candidate.id === assignment.id;
    const isProviderAssignment = candidate.providerId === providerId;
    const shouldCount = !isSameAssignment && isProviderAssignment;
    return shouldCount;
  });
  const candidateShiftCount = otherAssignedShifts.length + 1;
  return candidateShiftCount;
}

function providerEligibilityForAssignment(
  provider: Provider,
  room: AvailableRoom,
  assignment: ScheduleRoomAssignment,
  assignments: ScheduleRoomAssignment[],
  availability: ProviderWeeklyAvailabilityRecord | undefined,
): ProviderPickerOption {
  const reasons: ProviderIneligibilityReason[] = [];
  const availabilityOptions = availabilityOptionsForDay(availability, assignment.dayKey);
  const candidateShiftCount = candidateShiftCountForProvider(
    assignments,
    assignment,
    provider.id,
  );
  const minShiftsRequested = availability?.minShiftsRequested ?? 0;
  const maxShiftsRequested = availability?.maxShiftsRequested ?? 0;

  if (!provider.is_active) {
    const reason = createProviderReason(
      "inactive_provider",
      "other_hard_constraint",
      "Provider is inactive.",
    );
    reasons.push(reason);
  }

  const hasCenterCredential = provider.credentialed_center_ids.includes(room.centerId);

  if (!hasCenterCredential) {
    const reason = createProviderReason(
      "missing_center_credential",
      "missing_credential",
      "Missing credential for this center.",
    );
    reasons.push(reason);
  }

  for (const roomTypeId of room.roomTypeIds) {
    const hasRequiredSkill = provider.skill_room_type_ids.includes(roomTypeId);

    if (hasRequiredSkill) {
      continue;
    }

    const reason = createProviderReason(
      "missing_required_skill",
      "missing_skill",
      "Missing required room type skill.",
    );
    reasons.push(reason);
  }

  if (room.mdOnly) {
    const providerIsDoctor = provider.provider_type === "doctor";

    if (!providerIsDoctor) {
      const reason = createProviderReason(
        "md_requirement_not_met",
        "md_requirement_not_met",
        "MD requirement not met.",
      );
      reasons.push(reason);
    }
  }

  const availabilityIsLoading = availability === undefined;

  if (availabilityIsLoading) {
    const reason = createProviderReason(
      "provider_availability_unset",
      "availability_conflict",
      "Provider availability is still loading.",
    );
    reasons.push(reason);
  } else {
    const availabilityIsUnset = availabilityOptions.includes("unset");

    if (availabilityIsUnset) {
      const reason = createProviderReason(
        "provider_availability_unset",
        "availability_conflict",
        "Provider has not supplied availability for this day.",
      );
      reasons.push(reason);
    }

    const providerIsUnavailable = availabilityOptions.includes("none");

    if (providerIsUnavailable) {
      const reason = createProviderReason(
        "provider_unavailable",
        "availability_conflict",
        "Provider is unavailable on this day.",
      );
      reasons.push(reason);
    }

    const hasWorkAvailability = !availabilityIsUnset && !providerIsUnavailable;
    const shiftTypeIsAvailable = availabilityOptions.includes(assignment.shiftType);

    if (hasWorkAvailability && !shiftTypeIsAvailable) {
      const reason = createProviderReason(
        "provider_shift_type_unavailable",
        "availability_conflict",
        "Provider availability does not include this shift type.",
      );
      reasons.push(reason);
    }

  }

  const isEligible = reasons.length === 0;
  const option = {
    provider,
    isEligible,
    reasons,
    candidateShiftCount,
    minShiftsRequested,
    maxShiftsRequested,
    availabilityOptions,
  };
  return option;
}

function sortProviderOptions(
  options: ProviderPickerOption[],
): ProviderPickerOption[] {
  const sortedOptions = options.toSorted((first, second) => {
    if (first.isEligible !== second.isEligible) {
      return first.isEligible ? -1 : 1;
    }

    const comparison = first.provider.display_name.localeCompare(
      second.provider.display_name,
    );
    return comparison;
  });
  return sortedOptions;
}

function providerOptionsForAssignment(
  providers: Provider[],
  room: AvailableRoom,
  assignment: ScheduleRoomAssignment,
  assignments: ScheduleRoomAssignment[],
  availabilityByProviderId: Map<string, ProviderWeeklyAvailabilityRecord>,
): ProviderPickerOption[] {
  const options = providers.map((provider) => {
    const availability = availabilityByProviderId.get(provider.id);
    return providerEligibilityForAssignment(
      provider,
      room,
      assignment,
      assignments,
      availability,
    );
  });
  const sortedOptions = sortProviderOptions(options);
  return sortedOptions;
}

function selectedProviderOption(
  options: ProviderPickerOption[],
  providerId: string | null,
): ProviderPickerOption | null {
  if (providerId === null) {
    return null;
  }

  const option = options.find((candidate) => {
    return candidate.provider.id === providerId;
  });
  const selectedOption = option ?? null;
  return selectedOption;
}

function validationMessagesForSelection(
  option: ProviderPickerOption | null,
): string[] {
  if (option === null) {
    return ["No provider assigned."];
  }

  const messages = option.reasons.map((reason) => {
    return reason.message;
  });
  return messages;
}

function validationStatusForSelection(
  option: ProviderPickerOption | null,
): ScheduleRoomAssignment["validationStatus"] {
  if (option === null) {
    return "warning";
  }

  if (!option.isEligible) {
    return "invalid";
  }

  return "valid";
}

function providerPickerButtonLabel(option: ProviderPickerOption | null): string {
  if (option === null) {
    return "Select Provider...";
  }

  const label = option.provider.display_name;
  return label;
}

function providerPickerStatusLabel(option: ProviderPickerOption | null): string | null {
  if (option === null) {
    return null;
  }

  if (!option.isEligible) {
    return "Not eligible";
  }

  return "Eligible";
}

function optionAvailabilityLabel(option: ProviderPickerOption) {
  const label = option.availabilityOptions.join(", ").replaceAll("_", " ");
  return label;
}

function optionShiftCountLabel(option: ProviderPickerOption) {
  const label = `${option.candidateShiftCount}/${option.maxShiftsRequested} shifts`;
  return label;
}

function constraintLabelForReason(reason: ProviderIneligibilityReason) {
  if (reason.code === "inactive_provider") {
    return "Active provider";
  }

  if (reason.code === "provider_type_mismatch") {
    return "Provider type";
  }

  if (reason.code === "missing_center_credential") {
    return "Center credential";
  }

  if (reason.code === "inactive_center_credential") {
    return "Active credential";
  }

  if (reason.code === "missing_required_skill") {
    return "Required skill";
  }

  if (reason.code === "insufficient_required_skill_level") {
    return "Required skill level";
  }

  if (reason.code === "md_requirement_not_met") {
    return "MD requirement";
  }

  if (reason.code === "provider_availability_unset") {
    return "Availability";
  }

  if (reason.code === "provider_unavailable") {
    return "Availability";
  }

  if (reason.code === "provider_shift_type_unavailable") {
    return "Shift availability";
  }

  if (reason.code === "provider_double_booked") {
    return "Double booking";
  }

  return "Provider eligibility";
}

function slotSubject(
  assignment: ScheduleRoomAssignment,
  room: AvailableRoom | undefined,
) {
  const dayLabel = assignment.dayKey.charAt(0).toUpperCase() + assignment.dayKey.slice(1);
  const roomName = room?.name ?? "Unknown room";
  const shiftLabel = shiftTypeLabel(assignment.shiftType);
  const subject = `${dayLabel} ${roomName} ${shiftLabel}`;
  return subject;
}

function shiftRequestConstraintRows(
  providers: Provider[],
  assignments: ScheduleRoomAssignment[],
  availabilityByProviderId: Map<string, ProviderWeeklyAvailabilityRecord>,
): ConstraintRow[] {
  const rows = providers.flatMap((provider) => {
    const availability = availabilityByProviderId.get(provider.id);

    if (availability === undefined) {
      return [];
    }

    const minimum = availability.minShiftsRequested;
    const maximum = availability.maxShiftsRequested;
    const assignedShiftCount = assignedShiftCountForProvider(
      assignments,
      provider.id,
    );
    const rowsForProvider: ConstraintRow[] = [];

    if (assignedShiftCount < minimum) {
      const row = {
        id: `${provider.id}-provider_min_shifts_not_met`,
        severity: "Warning" as const,
        scope: "Provider week",
        subject: provider.display_name,
        constraint: "Minimum shifts",
        message: `${provider.display_name} has ${assignedShiftCount}/${minimum} requested minimum shifts.`,
      };
      rowsForProvider.push(row);
    }

    if (assignedShiftCount > maximum) {
      const row = {
        id: `${provider.id}-provider_max_shifts_exceeded`,
        severity: "Warning" as const,
        scope: "Provider week",
        subject: provider.display_name,
        constraint: "Maximum shifts",
        message: `${provider.display_name} has ${assignedShiftCount}/${maximum} requested maximum shifts.`,
      };
      rowsForProvider.push(row);
    }

    return rowsForProvider;
  });
  return rows;
}

function assignmentConstraintRows(
  providers: Provider[],
  assignments: ScheduleRoomAssignment[],
  rooms: AvailableRoom[],
  availabilityByProviderId: Map<string, ProviderWeeklyAvailabilityRecord>,
): ConstraintRow[] {
  const rows = assignments.flatMap((assignment) => {
    const room = rooms.find((availableRoom) => {
      return availableRoom.id === assignment.roomId;
    });
    const subject = slotSubject(assignment, room);

    if (room === undefined) {
      const row = {
        id: `${assignment.id}-room_missing`,
        severity: "Hard" as const,
        scope: "Slot",
        subject,
        constraint: "Room",
        message: "Room is missing or inactive.",
      };
      return [row];
    }

    const providerIsUnassigned = assignment.providerId === null;

    if (providerIsUnassigned) {
      const row = {
        id: `${assignment.id}-provider_assignment_required`,
        severity: "Hard" as const,
        scope: "Slot",
        subject,
        constraint: "Provider assignment",
        message: "Assign a provider before publishing this slot.",
      };
      return [row];
    }

    const providerOptions = providerOptionsForAssignment(
      providers,
      room,
      assignment,
      assignments,
      availabilityByProviderId,
    );
    const selectedOption = selectedProviderOption(
      providerOptions,
      assignment.providerId,
    );

    if (selectedOption === null) {
      const row = {
        id: `${assignment.id}-provider_missing`,
        severity: "Hard" as const,
        scope: "Slot",
        subject,
        constraint: "Provider",
        message: "Selected provider is no longer available.",
      };
      return [row];
    }

    const reasonRows = selectedOption.reasons.flatMap((reason) => {
      const isShiftRequestReason = reason.code === "provider_max_shifts_exceeded";

      if (isShiftRequestReason) {
        return [];
      }

      const row = {
        id: `${assignment.id}-${reason.code}`,
        severity: "Hard" as const,
        scope: "Slot",
        subject,
        constraint: constraintLabelForReason(reason),
        message: reason.message,
      };
      return [row];
    });
    return reasonRows;
  });
  return rows;
}

function scheduleConstraintRows(
  providers: Provider[],
  assignments: ScheduleRoomAssignment[],
  rooms: AvailableRoom[],
  availabilityByProviderId: Map<string, ProviderWeeklyAvailabilityRecord>,
): ConstraintRow[] {
  const assignmentRows = assignmentConstraintRows(
    providers,
    assignments,
    rooms,
    availabilityByProviderId,
  );
  const shiftRequestRows = shiftRequestConstraintRows(
    providers,
    assignments,
    availabilityByProviderId,
  );
  const rows = [...assignmentRows, ...shiftRequestRows];
  return rows;
}

function providerHasUnsetAvailability(
  availability: ProviderWeeklyAvailabilityRecord,
) {
  const unsetDays = availability.days.filter((day) => {
    const hasUnset = day.options.includes("unset");
    return hasUnset;
  });
  const hasUnsetAvailability = unsetDays.length > 0;
  return hasUnsetAvailability;
}

function providersWithUnsetAvailability(
  providers: Provider[],
  availabilityByProviderId: Map<string, ProviderWeeklyAvailabilityRecord>,
) {
  const unsetProviders = providers.filter((provider) => {
    const availability = availabilityByProviderId.get(provider.id);

    if (availability === undefined) {
      return false;
    }

    const hasUnsetAvailability = providerHasUnsetAvailability(availability);
    return hasUnsetAvailability;
  });
  return unsetProviders;
}

function shiftTypeLabel(shiftType: ScheduleRoomAssignment["shiftType"]) {
  if (shiftType === "full_shift") {
    return "Full shift";
  }

  if (shiftType === "first_half") {
    return "1st half";
  }

  if (shiftType === "second_half") {
    return "2nd half";
  }

  return "Short";
}

function shiftTypeContainerClassName(shiftType: ScheduleRoomAssignment["shiftType"]) {
  if (shiftType === "full_shift") {
    return "rounded-md border border-slate-200 bg-white p-3 shadow-sm";
  }

  if (shiftType === "first_half") {
    return "rounded-md border border-blue-200 bg-blue-50 p-3 shadow-sm";
  }

  if (shiftType === "second_half") {
    return "rounded-md border border-violet-200 bg-violet-50 p-3 shadow-sm";
  }

  return "rounded-md border border-amber-200 bg-amber-50 p-3 shadow-sm";
}

function parseDragPayload(data: string): DragPayload | null {
  try {
    const parsedData = JSON.parse(data) as DragPayload;
    return parsedData;
  } catch {
    return null;
  }
}

function assignmentsForDay(
  version: ScheduleVersion,
  dayKey: ScheduleDayKey,
): ScheduleRoomAssignment[] {
  const matchingAssignments = version.assignments.filter((assignment) => {
    return assignment.dayKey === dayKey;
  });
  const orderedAssignments = matchingAssignments.toSorted((first, second) => {
    return first.sortOrder - second.sortOrder;
  });
  return orderedAssignments;
}

function nextSortOrder(
  assignments: ScheduleRoomAssignment[],
  dayKey: ScheduleDayKey,
) {
  const dayAssignments = assignments.filter((assignment) => {
    return assignment.dayKey === dayKey;
  });
  const nextOrder = dayAssignments.length;
  return nextOrder;
}

function assignmentsForKey(
  assignments: ScheduleRoomAssignment[],
  dayKey: ScheduleDayKey,
) {
  const dayAssignments = assignments.filter((assignment) => {
    return assignment.dayKey === dayKey;
  });
  const orderedAssignments = dayAssignments.toSorted((first, second) => {
    return first.sortOrder - second.sortOrder;
  });
  return orderedAssignments;
}

function reorderAssignments(
  assignments: ScheduleRoomAssignment[],
): ScheduleRoomAssignment[] {
  const reorderedAssignments = dayColumns.flatMap((column) => {
    const dayAssignments = assignmentsForKey(assignments, column.key);
    const updatedAssignments = dayAssignments.map((assignment, index) => {
      const updatedAssignment = {
        ...assignment,
        sortOrder: index,
      };
      return updatedAssignment;
    });
    return updatedAssignments;
  });
  return reorderedAssignments;
}

function moveAssignment(
  assignments: ScheduleRoomAssignment[],
  draggedAssignment: DraggedAssignment,
  targetDayKey: ScheduleDayKey,
  targetIndex: number,
) {
  const movingAssignment = assignments.find((assignment) => {
    return assignment.id === draggedAssignment.assignmentId;
  });

  if (movingAssignment === undefined) {
    return assignments;
  }

  const remainingAssignments = assignments.filter((assignment) => {
    return assignment.id !== draggedAssignment.assignmentId;
  });
  const targetAssignments = assignmentsForKey(remainingAssignments, targetDayKey);
  const boundedIndex = Math.min(targetIndex, targetAssignments.length);
  const updatedMovingAssignment = {
    ...movingAssignment,
    dayKey: targetDayKey,
    sortOrder: boundedIndex,
  };
  const assignmentsBeforeTarget = remainingAssignments.filter((assignment) => {
    return assignment.dayKey !== targetDayKey;
  });
  const nextTargetAssignments = targetAssignments.toSpliced(
    boundedIndex,
    0,
    updatedMovingAssignment,
  );
  const nextAssignments = [...assignmentsBeforeTarget, ...nextTargetAssignments];
  const reorderedAssignments = reorderAssignments(nextAssignments);
  return reorderedAssignments;
}

function createRoomAssignment(
  room: AvailableRoom,
  dayKey: ScheduleDayKey,
  sortOrder: number,
): ScheduleRoomAssignment {
  const assignment: ScheduleRoomAssignment = {
    id: createAssignmentId(),
    dayKey,
    centerId: room.centerId,
    roomId: room.id,
    shiftType: "full_shift",
    providerId: null,
    startTime: "07:00",
    endTime: "15:00",
    sortOrder,
    validationStatus: "unknown",
    validationMessages: [],
  };
  return assignment;
}

export function ScheduleWorkspace({
  initialVersionDetail,
  providers,
  rooms,
  schedulePeriod,
  scheduleId,
}: ScheduleWorkspaceProps) {
  const availableRooms = useMemo(() => {
    return availableRoomsFromRows(rooms);
  }, [rooms]);
  const [workingVersion, setWorkingVersion] = useState<ScheduleVersion>(() => {
    if (initialVersionDetail !== null) {
      return versionFromDetail(schedulePeriod, initialVersionDetail);
    }

    return createInitialVersion(schedulePeriod);
  });
  const [savedVersionDetail, setSavedVersionDetail] =
    useState<ScheduleVersionDetail | null>(initialVersionDetail);
  const [publishEvents, setPublishEvents] = useState<SchedulePublishEvent[]>(() => {
    return publishEventsFromDetail(initialVersionDetail);
  });
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [showWeekends, setShowWeekends] = useState(false);
  const [showUnsetAvailabilityProviders, setShowUnsetAvailabilityProviders] = useState(false);
  const [openProviderAssignmentId, setOpenProviderAssignmentId] = useState<
    string | null
  >(null);
  const [availabilityByProviderId, setAvailabilityByProviderId] = useState<
    Map<string, ProviderWeeklyAvailabilityRecord>
  >(() => new Map());
  const [availabilityLoadMessage, setAvailabilityLoadMessage] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadWeeklyAvailability() {
      setAvailabilityLoadMessage(null);

      try {
        const availabilityEntries = await Promise.all(
          providers.map(async (provider) => {
            const availability = await getProviderWeeklyAvailability(
              scheduleId,
              provider.id,
            );
            const entry = [provider.id, availability] as const;
            return entry;
          }),
        );

        if (!isMounted) {
          return;
        }

        const nextAvailabilityByProviderId = new Map(availabilityEntries);
        setAvailabilityByProviderId(nextAvailabilityByProviderId);
      } catch {
        if (!isMounted) {
          return;
        }

        setAvailabilityLoadMessage("Availability could not be loaded.");
      }
    }

    loadWeeklyAvailability();

    return () => {
      isMounted = false;
    };
  }, [providers, scheduleId]);

  const visibleColumns = dayColumns.filter((column) => {
    const shouldShowColumn = showWeekends || !column.isWeekend;
    return shouldShowColumn;
  });
  const latestPublishEvent = publishEvents.at(-1);
  const assignedRoomCount = workingVersion.assignments.length;
  const lastPublishedLabel =
    latestPublishEvent === undefined
      ? "Not published yet"
      : formatTimelineDate(latestPublishEvent.publishedAt);

  function updateWorkingVersion(nextVersion: ScheduleVersion) {
    setWorkingVersion(nextVersion);
  }

  function savePayloadFromAssignments(
    assignments: ScheduleRoomAssignment[],
  ): ScheduleAssignmentSavePayload[] {
    const payload = assignments.map((assignment) => {
      const startTime = dateTimeForAssignment(
        schedulePeriod,
        assignment.dayKey,
        assignment.startTime,
      );
      const endTime = dateTimeForAssignment(
        schedulePeriod,
        assignment.dayKey,
        assignment.endTime,
      );
      const assignmentPayload = {
        provider_id: assignment.providerId,
        center_id: assignment.centerId,
        room_id: assignment.roomId,
        shift_requirement_id: null,
        required_provider_type: null,
        shift_type: assignment.shiftType,
        start_time: startTime,
        end_time: endTime,
        source: "manual",
        notes: null,
      };
      return assignmentPayload;
    });
    return payload;
  }

  async function handlePublishSchedule() {
    const invalidAssignments = workingVersion.assignments.filter((assignment) => {
      const room = roomForAssignment(assignment);

      if (room === undefined) {
        return true;
      }

      const options = providerOptionsForAssignment(
        providers,
        room,
        assignment,
        workingVersion.assignments,
        availabilityByProviderId,
      );
      const option = selectedProviderOption(options, assignment.providerId);
      const validationStatus = validationStatusForSelection(option);
      const isInvalid = validationStatus !== "valid";
      return isInvalid;
    });
    const hasInvalidAssignments = invalidAssignments.length > 0;

    if (hasInvalidAssignments) {
      setActionMessage("Resolve publish blockers before publishing.");
      return;
    }

    if (savedVersionDetail === null) {
      setActionMessage("Save a draft before publishing.");
      return;
    }

    setIsPublishing(true);
    setActionMessage(null);

    try {
      const response = await publishScheduleVersion(savedVersionDetail.version.id);
      const publishedAt = response.version.published_at;

      if (publishedAt !== null) {
        const nextEvent = schedulePublishEventSchema.parse({
          id: createPublishEventId(),
          versionId: response.version.id,
          publishedAt,
          summary: "Published saved schedule",
        });
        setPublishEvents((currentEvents) => {
          const nextEvents = [...currentEvents, nextEvent];
          return nextEvents;
        });
      }

      setSavedVersionDetail({
        ...savedVersionDetail,
        version: response.version,
      });
      setActionMessage("Schedule published.");
    } catch {
      setActionMessage("Publish failed because the saved version has blockers.");
    } finally {
      setIsPublishing(false);
    }
  }

  async function handleSaveDraft() {
    const nextAssignments = workingVersion.assignments.map((assignment) => {
      const room = roomForAssignment(assignment);

      if (room === undefined) {
        return assignment;
      }

      const options = providerOptionsForAssignment(
        providers,
        room,
        assignment,
        workingVersion.assignments,
        availabilityByProviderId,
      );
      const option = selectedProviderOption(options, assignment.providerId);
      const validationStatus = validationStatusForSelection(option);
      const validationMessages = validationMessagesForSelection(option);
      const nextAssignment = {
        ...assignment,
        validationStatus,
        validationMessages,
      };
      return nextAssignment;
    });
    const validatedVersion = scheduleVersionSchema.parse({
      ...workingVersion,
      status: "draft",
      assignments: nextAssignments,
    });
    const savePayload = savePayloadFromAssignments(nextAssignments);
    const parentVersionId =
      savedVersionDetail === null ? null : savedVersionDetail.version.id;
    const payload = {
      schedule_period_id: scheduleId,
      parent_schedule_version_id: parentVersionId,
      notes: null,
      assignments: savePayload,
    };

    setIsSaving(true);
    setActionMessage(null);
    updateWorkingVersion(validatedVersion);

    try {
      const detail = await saveDraftScheduleVersion(payload);
      const nextVersion = versionFromDetail(schedulePeriod, detail);
      setSavedVersionDetail(detail);
      updateWorkingVersion(nextVersion);
      setActionMessage("Draft saved.");
    } catch {
      setActionMessage("Draft save failed.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleGenerateSchedule() {
    const parentVersionId =
      savedVersionDetail === null ? null : savedVersionDetail.version.id;
    const payload = {
      parent_schedule_version_id: parentVersionId,
      notes: null,
      assignments: savePayloadFromAssignments(workingVersion.assignments),
    };

    setIsGenerating(true);
    setActionMessage(null);

    try {
      const detail = await generateScheduleVersion(scheduleId, payload);
      const generatedAssignmentCount = detail.assignments.length;
      const currentAssignmentCount = workingVersion.assignments.length;
      const wouldClearWorkingSchedule =
        generatedAssignmentCount === 0 && currentAssignmentCount > 0;

      if (wouldClearWorkingSchedule) {
        setActionMessage("Generation produced no assignments, so the current board was kept.");
        return;
      }

      const nextVersion = versionFromDetail(schedulePeriod, detail);
      const duration = detail.metrics.solve_duration_ms;
      setSavedVersionDetail(detail);
      updateWorkingVersion(nextVersion);
      setActionMessage(`Generated draft in ${duration} ms.`);
    } catch {
      setActionMessage("Schedule generation could not satisfy all constraints.");
    } finally {
      setIsGenerating(false);
    }
  }

  function handleDragStart(event: React.DragEvent, payload: DragPayload) {
    const payloadText = JSON.stringify(payload);
    event.dataTransfer.setData("application/json", payloadText);
    event.dataTransfer.effectAllowed = "move";
  }

  function handleDropOnColumn(event: React.DragEvent, dayKey: ScheduleDayKey) {
    event.preventDefault();

    const payloadText = event.dataTransfer.getData("application/json");
    const payload = parseDragPayload(payloadText);

    if (payload === null) {
      return;
    }

    if (payload.type === "available-room") {
      const room = availableRooms.find((availableRoom) => {
        return availableRoom.id === payload.roomId;
      });

      if (room === undefined) {
        return;
      }

      const sortOrder = nextSortOrder(workingVersion.assignments, dayKey);
      const assignment = createRoomAssignment(room, dayKey, sortOrder);
      const assignments = [...workingVersion.assignments, assignment];
      const nextVersion = scheduleVersionSchema.parse({
        ...workingVersion,
        assignments,
      });
      updateWorkingVersion(nextVersion);
      return;
    }

    const draggedAssignment = {
      assignmentId: payload.assignmentId,
      dayKey: payload.dayKey,
    };
    const sortOrder = nextSortOrder(workingVersion.assignments, dayKey);
    const assignments = moveAssignment(
      workingVersion.assignments,
      draggedAssignment,
      dayKey,
      sortOrder,
    );
    const nextVersion = scheduleVersionSchema.parse({
      ...workingVersion,
      assignments,
    });
    updateWorkingVersion(nextVersion);
  }

  function handleDropOnAssignment(
    event: React.DragEvent,
    dayKey: ScheduleDayKey,
    targetIndex: number,
  ) {
    event.preventDefault();
    event.stopPropagation();

    const payloadText = event.dataTransfer.getData("application/json");
    const payload = parseDragPayload(payloadText);

    if (payload === null) {
      return;
    }

    if (payload.type === "available-room") {
      const room = availableRooms.find((availableRoom) => {
        return availableRoom.id === payload.roomId;
      });

      if (room === undefined) {
        return;
      }

      const assignment = createRoomAssignment(room, dayKey, targetIndex);
      const sameDayAssignments = assignmentsForKey(
        workingVersion.assignments,
        dayKey,
      );
      const otherAssignments = workingVersion.assignments.filter((item) => {
        return item.dayKey !== dayKey;
      });
      const nextSameDayAssignments = sameDayAssignments.toSpliced(
        targetIndex,
        0,
        assignment,
      );
      const assignments = reorderAssignments([
        ...otherAssignments,
        ...nextSameDayAssignments,
      ]);
      const nextVersion = scheduleVersionSchema.parse({
        ...workingVersion,
        assignments,
      });
      updateWorkingVersion(nextVersion);
      return;
    }

    const draggedAssignment = {
      assignmentId: payload.assignmentId,
      dayKey: payload.dayKey,
    };
    const assignments = moveAssignment(
      workingVersion.assignments,
      draggedAssignment,
      dayKey,
      targetIndex,
    );
    const nextVersion = scheduleVersionSchema.parse({
      ...workingVersion,
      assignments,
    });
    updateWorkingVersion(nextVersion);
  }

  function handleDeleteAssignment(assignmentId: string) {
    const assignments = workingVersion.assignments.filter((assignment) => {
      return assignment.id !== assignmentId;
    });
    const reorderedAssignments = reorderAssignments(assignments);
    const nextVersion = scheduleVersionSchema.parse({
      ...workingVersion,
      assignments: reorderedAssignments,
    });
    updateWorkingVersion(nextVersion);
  }

  function handleShiftTypeChanged(
    assignmentId: string,
    shiftType: ScheduleRoomAssignment["shiftType"],
  ) {
    const assignments = workingVersion.assignments.map((assignment) => {
      if (assignment.id !== assignmentId) {
        return assignment;
      }

      const nextAssignment = {
        ...assignment,
        shiftType,
      };
      return nextAssignment;
    });
    const nextVersion = scheduleVersionSchema.parse({
      ...workingVersion,
      assignments,
    });
    updateWorkingVersion(nextVersion);
  }

  function savedAssignmentIdForRequest(assignment: ScheduleRoomAssignment) {
    const savedAssignment = savedVersionDetail?.assignments.find((candidate) => {
      return candidate.id === assignment.id;
    });
    const assignmentId = savedAssignment?.id ?? null;
    return assignmentId;
  }

  async function verifiedProviderOption(
    assignment: ScheduleRoomAssignment,
    option: ProviderPickerOption,
  ) {
    const startTime = dateTimeForAssignment(
      schedulePeriod,
      assignment.dayKey,
      assignment.startTime,
    );
    const endTime = dateTimeForAssignment(
      schedulePeriod,
      assignment.dayKey,
      assignment.endTime,
    );
    const savedAssignmentId = savedAssignmentIdForRequest(assignment);
    const savedVersionId = savedVersionDetail?.version.id ?? null;
    const payload = {
      schedule_period_id: scheduleId,
      schedule_version_id: savedVersionId,
      assignment_id: savedAssignmentId,
      provider_id: option.provider.id,
      center_id: assignment.centerId,
      room_id: assignment.roomId,
      required_provider_type: null,
      shift_type: assignment.shiftType,
      start_time: startTime,
      end_time: endTime,
    };
    const response = await checkProviderSlotEligibility(payload);
    const backendReasons = reasonsFromBackendEligibility(response);
    const reasons = mergeProviderReasons(option.reasons, backendReasons);
    const verifiedOption = {
      ...option,
      isEligible: option.isEligible && response.is_eligible,
      reasons,
    };
    return verifiedOption;
  }

  async function handleProviderSelected(
    assignment: ScheduleRoomAssignment,
    option: ProviderPickerOption,
  ) {
    let selectedOption = option;

    try {
      selectedOption = await verifiedProviderOption(assignment, option);
    } catch {
      const reason = createProviderReason(
        "provider_eligibility_check_failed",
        "other_hard_constraint",
        "Provider eligibility could not be verified.",
      );
      const reasons = mergeProviderReasons(option.reasons, [reason]);
      selectedOption = {
        ...option,
        isEligible: false,
        reasons,
      };
    }

    const validationStatus = validationStatusForSelection(selectedOption);
    const validationMessages = validationMessagesForSelection(selectedOption);
    const assignments = workingVersion.assignments.map((currentAssignment) => {
      if (currentAssignment.id !== assignment.id) {
        return currentAssignment;
      }

      const nextAssignment = {
        ...currentAssignment,
        providerId: selectedOption.provider.id,
        validationStatus,
        validationMessages,
      };
      return nextAssignment;
    });
    const nextVersion = scheduleVersionSchema.parse({
      ...workingVersion,
      assignments,
    });
    updateWorkingVersion(nextVersion);
    setOpenProviderAssignmentId(null);
  }

  function handleProviderCleared(assignment: ScheduleRoomAssignment) {
    const option = null;
    const validationStatus = validationStatusForSelection(option);
    const validationMessages = validationMessagesForSelection(option);
    const assignments = workingVersion.assignments.map((currentAssignment) => {
      if (currentAssignment.id !== assignment.id) {
        return currentAssignment;
      }

      const nextAssignment = {
        ...currentAssignment,
        providerId: null,
        validationStatus,
        validationMessages,
      };
      return nextAssignment;
    });
    const nextVersion = scheduleVersionSchema.parse({
      ...workingVersion,
      assignments,
    });
    updateWorkingVersion(nextVersion);
    setOpenProviderAssignmentId(null);
  }

  function handleProviderPickerToggled(assignmentId: string) {
    setOpenProviderAssignmentId((currentAssignmentId) => {
      const assignmentIsOpen = currentAssignmentId === assignmentId;

      if (assignmentIsOpen) {
        return null;
      }

      return assignmentId;
    });
  }

  function roomForAssignment(assignment: ScheduleRoomAssignment) {
    const room = availableRooms.find((availableRoom) => {
      return availableRoom.id === assignment.roomId;
    });
    return room;
  }

  const hasSavedVersion = savedVersionDetail !== null;
  const constraintRows = scheduleConstraintRows(
    providers,
    workingVersion.assignments,
    availableRooms,
    availabilityByProviderId,
  );
  const hardConstraintRows = constraintRows.filter((row) => {
    return row.severity === "Hard";
  });
  const publishBlockerCount = hardConstraintRows.length;
  const unsetAvailabilityProviders = providersWithUnsetAvailability(
    providers,
    availabilityByProviderId,
  );
  const availabilityLoadIsComplete = availabilityByProviderId.size === providers.length;
  const unsetAvailabilityCount = unsetAvailabilityProviders.length;
  const canPublish =
    publishBlockerCount === 0 && assignedRoomCount > 0 && hasSavedVersion;

  return (
    <div className="space-y-5">
      <section className="rounded-md border border-slate-200 bg-white px-4 py-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <Link
              href="/schedules"
              className="text-xs font-semibold text-teal-700 hover:text-teal-900"
            >
              Back to schedules
            </Link>
            <h3 className="mt-1 text-lg font-semibold text-slate-950">
              {workingVersion.name}
            </h3>
            <p className="text-sm text-slate-500">
              Working schedule with {assignedRoomCount} assigned rooms and{" "}
              {publishBlockerCount} publish blockers. Last publish:
              {" "}
              {lastPublishedLabel}.
            </p>
            {actionMessage !== null ? (
              <p className="mt-1 text-sm font-medium text-teal-700">
                {actionMessage}
              </p>
            ) : null}
            {availabilityLoadMessage !== null ? (
              <p className="mt-1 text-sm font-medium text-red-700">
                {availabilityLoadMessage}
              </p>
            ) : null}
            <div className="mt-2">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm text-slate-600">
                  {availabilityLoadIsComplete
                    ? `${unsetAvailabilityCount} out of ${providers.length} Providers have unset availability.`
                    : "Checking provider availability..."}
                </p>
                {unsetAvailabilityCount > 0 ? (
                  <button
                    type="button"
                    onClick={() =>
                      setShowUnsetAvailabilityProviders((currentValue) => !currentValue)
                    }
                    className="text-sm font-semibold text-teal-700 hover:text-teal-900"
                  >
                    {showUnsetAvailabilityProviders ? "Hide providers" : "Show providers"}
                  </button>
                ) : null}
              </div>
              {showUnsetAvailabilityProviders && unsetAvailabilityCount > 0 ? (
                <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                  <ul className="flex flex-wrap gap-2">
                    {unsetAvailabilityProviders.map((provider) => {
                      return (
                        <li
                          key={provider.id}
                          className="rounded-md bg-white px-2 py-1 text-xs font-medium text-slate-700"
                        >
                          {provider.display_name}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <label className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                checked={showWeekends}
                onChange={(event) => setShowWeekends(event.target.checked)}
                className="h-4 w-4 accent-teal-700"
              />
              Show weekends
            </label>
            <button
              type="button"
              onClick={handleGenerateSchedule}
              disabled={isGenerating}
              className="inline-flex h-9 items-center justify-center rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100"
            >
              {isGenerating ? "Generating" : "Generate draft"}
            </button>
            <button
              type="button"
              onClick={handleSaveDraft}
              disabled={isSaving}
              className="inline-flex h-9 items-center justify-center rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100"
            >
              {isSaving ? "Saving" : "Save draft"}
            </button>
            <button
              type="button"
              onClick={handlePublishSchedule}
              disabled={!canPublish || isPublishing}
              className="inline-flex h-9 items-center justify-center rounded-md bg-teal-700 px-3 text-sm font-semibold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {isPublishing ? "Publishing" : "Publish changes"}
            </button>
          </div>
        </div>
      </section>
      <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_18rem]">
        <section className="min-w-0 rounded-md border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-4 py-3">
            <h3 className="text-base font-semibold text-slate-950">Schedule editor</h3>
            <p className="text-sm text-slate-500">
              Drag rooms into a day, then reorder within each day.
            </p>
          </div>
          <div className="grid min-h-[32rem] gap-3 overflow-x-auto p-4 lg:grid-cols-5">
            {visibleColumns.map((column) => {
              const dayAssignments = assignmentsForDay(workingVersion, column.key);
              return (
                <div
                  key={column.key}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => handleDropOnColumn(event, column.key)}
                  className="flex min-h-96 min-w-52 flex-col rounded-md border border-slate-200 bg-slate-50"
                >
                  <div className="border-b border-slate-200 px-3 py-2">
                    <h4 className="text-sm font-semibold text-slate-950">
                      {column.label}
                    </h4>
                    <p className="text-xs text-slate-500">
                      {dayAssignments.length} rooms
                    </p>
                  </div>
                  <div className="flex flex-1 flex-col gap-2 p-2">
                    {dayAssignments.map((assignment, index) => {
                      const room = roomForAssignment(assignment);
                      const roomName = room?.name ?? "Unknown room";
                      const centerName = room?.centerName ?? "Unknown center";
                      const mdOnly = room?.mdOnly ?? false;
                      const roomTypeNames = room?.roomTypeNames ?? [];
                      const providerOptions =
                        room === undefined
                          ? []
                          : providerOptionsForAssignment(
                              providers,
                              room,
                              assignment,
                              workingVersion.assignments,
                              availabilityByProviderId,
                            );
                      const selectedOption = selectedProviderOption(
                        providerOptions,
                        assignment.providerId,
                      );
                      const selectedMessages = validationMessagesForSelection(
                        selectedOption,
                      );
                      const selectedStatus = validationStatusForSelection(
                        selectedOption,
                      );
                      const providerPickerIsOpen =
                        openProviderAssignmentId === assignment.id;
                      const providerPickerLabel =
                        providerPickerButtonLabel(selectedOption);
                      const providerPickerStatus =
                        providerPickerStatusLabel(selectedOption);
                      const assignmentContainerClassName = shiftTypeContainerClassName(
                        assignment.shiftType,
                      );
                      const assignmentShiftTypeLabel = shiftTypeLabel(
                        assignment.shiftType,
                      );
                      return (
                        <div
                          key={assignment.id}
                          draggable
                          onDragStart={(event) =>
                            handleDragStart(event, {
                              type: "scheduled-room",
                              assignmentId: assignment.id,
                              dayKey: column.key,
                            })
                          }
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={(event) =>
                            handleDropOnAssignment(event, column.key, index)
                          }
                          className={assignmentContainerClassName}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="text-sm font-semibold text-slate-950">
                                {roomName}
                              </p>
                              <p className="text-xs text-slate-500">{centerName}</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleDeleteAssignment(assignment.id)}
                              className="rounded-md px-2 text-sm font-semibold text-slate-500 hover:bg-red-50 hover:text-red-700"
                              aria-label={`Remove ${roomName}`}
                            >
                              x
                            </button>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1">
                            <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                              {assignmentShiftTypeLabel}
                            </span>
                            {mdOnly ? (
                              <span className="rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">
                                MDs Only
                              </span>
                            ) : null}
                            {roomTypeNames.length === 0 ? (
                              <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-500">
                                No room types
                              </span>
                            ) : null}
                            {roomTypeNames.map((roomTypeName) => {
                              return (
                                <span
                                  key={roomTypeName}
                                  className="rounded-md bg-teal-50 px-2 py-1 text-xs font-medium text-teal-800"
                                >
                                  {roomTypeName}
                                </span>
                              );
                            })}
                          </div>
                          <div className="mt-2">
                            <label className="text-xs font-semibold uppercase text-slate-500">
                              Shift type
                            </label>
                            <select
                              value={assignment.shiftType}
                              onChange={(event) =>
                                handleShiftTypeChanged(
                                  assignment.id,
                                  event.target.value as ScheduleRoomAssignment["shiftType"],
                                )
                              }
                              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-sm text-slate-700"
                            >
                              <option value="full_shift">Full shift</option>
                              <option value="first_half">1st half</option>
                              <option value="second_half">2nd half</option>
                              <option value="short_shift">Short</option>
                            </select>
                          </div>
                          <div className="mt-3 border-t border-slate-100 pt-3">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-xs font-semibold uppercase text-slate-500">
                                Provider
                              </p>
                              <span
                                className={
                                  selectedStatus === "valid"
                                    ? "rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700"
                                    : "rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800"
                                }
                              >
                                {selectedStatus === "valid"
                                  ? "Eligible"
                                  : "Not publishable"}
                              </span>
                            </div>
                            <div className="mt-2 max-h-44 space-y-1 overflow-y-auto">
                              <div className="flex items-stretch gap-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleProviderPickerToggled(assignment.id)
                                  }
                                  disabled={providerOptions.length === 0}
                                  aria-expanded={providerPickerIsOpen}
                                  className={
                                    selectedOption === null
                                      ? "min-w-0 flex-1 rounded-md border border-dashed border-slate-300 bg-white px-2 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
                                      : "min-w-0 flex-1 rounded-md border border-teal-600 bg-teal-50 px-2 py-2 text-left"
                                  }
                                >
                                  <span className="block truncate text-sm font-semibold text-slate-950">
                                    {providerPickerLabel}
                                  </span>
                                  {providerPickerStatus === null ? null : (
                                    <span
                                      className={
                                        selectedOption?.isEligible
                                          ? "block text-xs text-emerald-700"
                                          : "block text-xs text-red-700"
                                      }
                                    >
                                      {providerPickerStatus}
                                    </span>
                                  )}
                                  {selectedOption === null ? null : (
                                    <span className="block text-xs text-slate-500">
                                      {optionAvailabilityLabel(selectedOption)} -{" "}
                                      {optionShiftCountLabel(selectedOption)}
                                    </span>
                                  )}
                                </button>
                                {selectedOption === null ? null : (
                                  <button
                                    type="button"
                                    onClick={() => handleProviderCleared(assignment)}
                                    className="rounded-md border border-slate-300 px-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                                  >
                                    Clear
                                  </button>
                                )}
                              </div>
                              {providerPickerIsOpen
                                ? providerOptions.map((option) => {
                                    const isSelected =
                                      option.provider.id === assignment.providerId;
                                    const firstReason = option.reasons.at(0);
                                    const availabilityLabel = optionAvailabilityLabel(option);
                                    const shiftCountLabel = optionShiftCountLabel(option);
                                    return (
                                      <button
                                        key={option.provider.id}
                                        type="button"
                                        onClick={() =>
                                          handleProviderSelected(assignment, option)
                                        }
                                        className={
                                          isSelected
                                            ? "w-full rounded-md border border-teal-600 bg-teal-50 px-2 py-2 text-left"
                                            : "w-full rounded-md border border-slate-200 bg-white px-2 py-2 text-left hover:bg-slate-50"
                                        }
                                      >
                                        <span className="block text-sm font-semibold text-slate-950">
                                          {option.provider.display_name}
                                        </span>
                                        <span className="block text-xs text-slate-500">
                                          {availabilityLabel} - {shiftCountLabel}
                                        </span>
                                        <span
                                          className={
                                            option.isEligible
                                              ? "block text-xs text-emerald-700"
                                              : "block text-xs text-red-700"
                                          }
                                        >
                                          {option.isEligible
                                            ? "Eligible"
                                            : `Not eligible: ${
                                                firstReason?.message ??
                                                "Review required."
                                              }`}
                                        </span>
                                      </button>
                                    );
                                  })
                                : null}
                              {providerOptions.length === 0 ? (
                                <p className="rounded-md border border-dashed border-slate-300 px-2 py-3 text-sm text-slate-500">
                                  Add providers before assigning this slot.
                                </p>
                              ) : null}
                            </div>
                            {selectedMessages.length > 0 ? (
                              <div className="mt-2 space-y-1">
                                {selectedMessages.map((message) => {
                                  return (
                                    <p
                                      key={message}
                                      className="text-xs leading-5 text-red-700"
                                    >
                                      {message}
                                    </p>
                                  );
                                })}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                    {dayAssignments.length === 0 ? (
                      <div className="flex flex-1 items-center justify-center rounded-md border border-dashed border-slate-300 px-3 py-8 text-center text-sm text-slate-500">
                        Drop rooms here
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
          {constraintRows.length > 0 ? (
            <div className="border-t border-slate-200 px-4 py-3">
              <h4 className="text-sm font-semibold text-slate-950">
                Schedule constraints
              </h4>
              <div className="mt-2 overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead>
                    <tr className="text-left text-xs font-semibold uppercase text-slate-500">
                      <th scope="col" className="py-2 pr-4">
                        Severity
                      </th>
                      <th scope="col" className="px-4 py-2">
                        Scope
                      </th>
                      <th scope="col" className="px-4 py-2">
                        Subject
                      </th>
                      <th scope="col" className="px-4 py-2">
                        Constraint
                      </th>
                      <th scope="col" className="py-2 pl-4">
                        Message
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {constraintRows.map((row) => {
                      const severityClassName =
                        row.severity === "Hard"
                          ? "rounded-md bg-red-50 px-2 py-1 text-xs font-semibold text-red-700"
                          : "rounded-md bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700";
                      return (
                        <tr key={row.id}>
                          <td className="py-2 pr-4">
                            <span className={severityClassName}>
                              {row.severity}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-slate-700">
                            {row.scope}
                          </td>
                          <td className="px-4 py-2 text-slate-700">
                            {row.subject}
                          </td>
                          <td className="px-4 py-2 font-medium text-slate-900">
                            {row.constraint}
                          </td>
                          <td className="py-2 pl-4 text-slate-600">
                            {row.message}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </section>
        <div className="space-y-6">
          <aside className="rounded-md border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-4 py-3">
              <h3 className="text-sm font-semibold text-slate-950">
                Available rooms
              </h3>
            </div>
            <div className="max-h-[42rem] space-y-2 overflow-y-auto p-3">
              {availableRooms.length === 0 ? (
                <p className="text-sm leading-6 text-slate-500">
                  Add active rooms before building schedules.
                </p>
              ) : null}
              {availableRooms.map((room) => {
                return (
                  <div
                    key={room.id}
                    draggable
                    onDragStart={(event) =>
                      handleDragStart(event, {
                        type: "available-room",
                        roomId: room.id,
                      })
                    }
                    className="cursor-grab rounded-md border border-slate-200 bg-white p-3 shadow-sm active:cursor-grabbing"
                  >
                    <p className="text-sm font-semibold text-slate-950">
                      {room.centerName}
                    </p>
                    <p className="text-xs text-slate-500">{room.name}</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {room.mdOnly ? (
                        <span className="rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">
                          MDs Only
                        </span>
                      ) : null}
                      {room.roomTypeNames.length === 0 ? (
                        <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-500">
                          No room types
                        </span>
                      ) : null}
                      {room.roomTypeNames.map((roomTypeName) => {
                        return (
                          <span
                            key={roomTypeName}
                            className="rounded-md bg-teal-50 px-2 py-1 text-xs font-medium text-teal-800"
                          >
                            {roomTypeName}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </aside>
          <aside className="rounded-md border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-4 py-3">
              <h3 className="text-sm font-semibold text-slate-950">
                Publish timeline
              </h3>
            </div>
            <div className="space-y-3 p-3">
              {publishEvents.map((event) => {
                return (
                  <div
                    key={event.id}
                    className="rounded-md border border-slate-200 px-3 py-2"
                  >
                    <p className="text-sm font-semibold text-slate-950">
                      {event.summary}
                    </p>
                    <p className="text-xs text-slate-500">
                      {formatTimelineDate(event.publishedAt)}
                    </p>
                  </div>
                );
              })}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
