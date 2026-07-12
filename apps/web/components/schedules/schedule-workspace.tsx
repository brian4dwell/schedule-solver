"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  applyScheduleStructureTemplate,
  checkProviderSlotEligibility,
  createScheduleStructureTemplate,
  deleteScheduleStructureTemplate,
  generateScheduleVersion,
  getScheduleVersion,
  getProviderWeeklyAvailability,
  publishScheduleVersion,
  saveDraftScheduleVersion,
  updateScheduleStructureTemplate,
  type Center,
  type Provider,
  type ProviderSlotEligibility,
  type ProviderWeeklyAvailabilityRecord,
  type PersistedScheduleVersion,
  type Room,
  type ScheduleAssignmentSavePayload,
  type SchedulePeriod,
  type ScheduleStructureTemplate,
  type ScheduleStructureTemplateApplyResponse,
  type ScheduleStructureTemplateSavePayload,
  type ScheduleVersionDetail,
} from "@/lib/api";
import type {
  AvailabilityOption,
  Weekday,
} from "@/lib/schemas/provider-weekly-availability";
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
import {
  captureScheduleWorkflowException,
  trackScheduleDraftSaved,
  trackScheduleGenerated,
  trackSchedulePublished,
} from "@/lib/logrocket";
import { useToast } from "@/components/ui/toast-provider";

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

type DropIndicator = {
  dayKey: ScheduleDayKey;
  targetIndex: number;
};

type ScheduleWorkspaceProps = {
  initialVersionDetail: ScheduleVersionDetail | null;
  initialTemplates: ScheduleStructureTemplate[];
  initialVersions: PersistedScheduleVersion[];
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

type ScheduleDraftAssignmentSnapshot = {
  id: string;
  slotDate: string;
  centerId: string;
  roomId: string;
  shiftType: ScheduleRoomAssignment["shiftType"];
  providerId: string | null;
  startTime: string;
  endTime: string;
  sortOrder: number;
};

type ScheduleDraftSnapshot = {
  notes: string;
  assignments: ScheduleDraftAssignmentSnapshot[];
};

const emptyScheduleDraftSnapshot: ScheduleDraftSnapshot = {
  notes: "",
  assignments: [],
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

const availabilityReminderWeekdays: Weekday[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
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

function formatDayHeaderDate(value: Date) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    timeZone: "UTC",
  });
  const formattedValue = formatter.format(value);
  const dateLabel = formattedValue.replace(" ", "-");
  return dateLabel;
}

function createInitialVersion(schedulePeriod: SchedulePeriod): ScheduleVersion {
  const createdAt = new Date().toISOString();
  const version = {
    id: `${schedulePeriod.id}-working`,
    name: `${schedulePeriod.name} Working Version`,
    status: "working",
    createdAt,
    notes: "",
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

function dayKeyForAssignment(startTime: string): ScheduleDayKey {
  const assignmentDate = new Date(startTime);
  const assignmentWeekday = assignmentDate.getUTCDay();
  const dayColumnIndex = (assignmentWeekday + 6) % 7;
  const dayColumn = dayColumns[dayColumnIndex];

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
  const periodStartWeekday = (periodStart.getUTCDay() + 6) % 7;
  const targetDayIndex = dayIndexForDayKey(dayKey);
  const weekdayOffset = (targetDayIndex - periodStartWeekday + 7) % 7;
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  const dateTime = periodStart.getTime() + weekdayOffset * millisecondsPerDay;
  const date = new Date(dateTime);
  return date;
}

function dateTimeForAssignment(
  slotDate: string,
  timeValue: string,
): string {
  const timeParts = timeValue.split(":");
  const hour = Number(timeParts[0]);
  const minute = Number(timeParts[1]);
  const date = dateAtUtcMidnight(slotDate);
  date.setUTCHours(hour, minute, 0, 0);
  const value = date.toISOString();
  return value;
}

function assignmentDateTimeRange(
  assignment: ScheduleRoomAssignment,
): { startDateTime: string; endDateTime: string } {
  const startDateTime = dateTimeForAssignment(
    assignment.slotDate,
    assignment.startTime,
  );
  const rawEndDateTime = dateTimeForAssignment(
    assignment.slotDate,
    assignment.endTime,
  );
  const range = {
    startDateTime,
    endDateTime: rawEndDateTime,
  };
  return range;
}

function slotDateForDayKey(
  schedulePeriod: SchedulePeriod,
  dayKey: ScheduleDayKey,
) {
  const date = dateForDayKey(schedulePeriod, dayKey);
  const value = date.toISOString().slice(0, 10);
  return value;
}

function scheduleNotesPayload(notes: string) {
  const payloadNotes = notes === "" ? null : notes;
  return payloadNotes;
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
    const hardViolations = violations.filter((violation) => {
      return violation.severity === "hard_violation";
    });
    const warningViolations = violations.filter((violation) => {
      return violation.severity === "warning";
    });
    const hasHardViolations = hardViolations.length > 0;
    const hasWarningViolations = warningViolations.length > 0;
    const validationStatus = hasHardViolations
      ? "invalid"
      : hasWarningViolations
        ? "warning"
        : "valid";
    const roomAssignment = {
      id: assignment.room_slot_id,
      dayKey: dayKeyForAssignment(assignment.schedule_date),
      slotDate: assignment.schedule_date,
      slotDateChanged: false,
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
    notes: detail.version.notes ?? "",
    assignments,
  };
  const parsedVersion = scheduleVersionSchema.parse(version);
  return parsedVersion;
}

function preservedBestEffortAssignment(
  assignment: ScheduleRoomAssignment,
): ScheduleRoomAssignment {
  const preservedAssignment = {
    ...assignment,
    providerId: null,
    validationStatus: "invalid" as const,
    validationMessages: ["Best-effort solve left this slot unassigned."],
  };
  return preservedAssignment;
}

function versionWithPreservedBestEffortSlots(
  previousVersion: ScheduleVersion,
  generatedVersion: ScheduleVersion,
): ScheduleVersion {
  const generatedAssignmentIds = new Set(
    generatedVersion.assignments.map((assignment) => {
      return assignment.id;
    }),
  );
  const missingAssignments = previousVersion.assignments.filter((assignment) => {
    const assignmentWasGenerated = generatedAssignmentIds.has(assignment.id);
    return !assignmentWasGenerated;
  });
  const preservedAssignments = missingAssignments.map((assignment) => {
    return preservedBestEffortAssignment(assignment);
  });
  const assignments = [
    ...generatedVersion.assignments,
    ...preservedAssignments,
  ];
  const reorderedAssignments = reorderAssignments(assignments);
  const version = {
    ...generatedVersion,
    assignments: reorderedAssignments,
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

function scheduleDraftAssignmentSnapshot(
  assignment: ScheduleRoomAssignment,
): ScheduleDraftAssignmentSnapshot {
  const snapshot = {
    id: assignment.id,
    slotDate: assignment.slotDate,
    centerId: assignment.centerId,
    roomId: assignment.roomId,
    shiftType: assignment.shiftType,
    providerId: assignment.providerId,
    startTime: assignment.startTime,
    endTime: assignment.endTime,
    sortOrder: assignment.sortOrder,
  };
  return snapshot;
}

function scheduleDraftSnapshot(version: ScheduleVersion): ScheduleDraftSnapshot {
  const orderedAssignments = reorderAssignments(version.assignments);
  const assignmentSnapshots = orderedAssignments.map((assignment) => {
    const snapshot = scheduleDraftAssignmentSnapshot(assignment);
    return snapshot;
  });
  const snapshot = {
    notes: version.notes,
    assignments: assignmentSnapshots,
  };
  return snapshot;
}

function scheduleDraftSnapshotsMatch(
  currentSnapshot: ScheduleDraftSnapshot,
  savedSnapshot: ScheduleDraftSnapshot,
) {
  const currentText = JSON.stringify(currentSnapshot);
  const savedText = JSON.stringify(savedSnapshot);
  const snapshotsMatch = currentText === savedText;
  return snapshotsMatch;
}

function navigationHrefFromClickEvent(event: MouseEvent) {
  if (event.defaultPrevented) {
    return null;
  }

  if (event.button !== 0) {
    return null;
  }

  const usesModifiedClick =
    event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;

  if (usesModifiedClick) {
    return null;
  }

  const target = event.target;

  if (!(target instanceof Element)) {
    return null;
  }

  const anchor = target.closest("a");

  if (!(anchor instanceof HTMLAnchorElement)) {
    return null;
  }

  const targetOpensElsewhere = anchor.target !== "";

  if (targetOpensElsewhere) {
    return null;
  }

  const destinationUrl = new URL(anchor.href);
  const currentUrl = new URL(window.location.href);
  const originMatches = destinationUrl.origin === currentUrl.origin;

  if (!originMatches) {
    return null;
  }

  const destinationHref =
    destinationUrl.pathname + destinationUrl.search + destinationUrl.hash;
  const currentHref =
    currentUrl.pathname + currentUrl.search + currentUrl.hash;
  const staysOnCurrentHref = destinationHref === currentHref;

  if (staysOnCurrentHref) {
    return null;
  }

  return destinationHref;
}

function versionOptionLabel(version: PersistedScheduleVersion) {
  const firstLetter = version.status.charAt(0);
  const capitalizedFirstLetter = firstLetter.toUpperCase();
  const remainingLetters = version.status.slice(1);
  const statusLabel = `${capitalizedFirstLetter}${remainingLetters}`;
  const label = `Version ${version.version_number} - ${statusLabel}`;
  return label;
}

function upsertVersionOption(
  versions: PersistedScheduleVersion[],
  nextVersion: PersistedScheduleVersion,
) {
  const otherVersions = versions.filter((version) => {
    const isSameVersion = version.id === nextVersion.id;
    return !isSameVersion;
  });
  const nextVersions = [...otherVersions, nextVersion];
  const sortedVersions = nextVersions.toSorted((first, second) => {
    const comparison = second.version_number - first.version_number;
    return comparison;
  });
  return sortedVersions;
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
  severity: ProviderIneligibilityReason["severity"],
  category: ProviderIneligibilityReason["category"],
  message: string,
): ProviderIneligibilityReason {
  const reason = {
    code,
    severity,
    category,
    message,
  };
  return reason;
}

function createHardProviderReason(
  code: string,
  category: ProviderIneligibilityReason["category"],
  message: string,
): ProviderIneligibilityReason {
  const reason = createProviderReason(
    code,
    "hard_violation",
    category,
    message,
  );
  return reason;
}

function createWarningProviderReason(
  code: string,
  category: ProviderIneligibilityReason["category"],
  message: string,
): ProviderIneligibilityReason {
  const reason = createProviderReason(
    code,
    "warning",
    category,
    message,
  );
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
  const reasons = response.violations.map((violation) => {
    const category = normalizedReasonCategory(violation.category);
    const severity =
      violation.severity === "warning" ? "warning" : "hard_violation";
    const reason = createProviderReason(
      violation.constraint_type,
      severity,
      category,
      violation.message,
    );
    return reason;
  });
  return reasons;
}

function fullShiftAvailabilityAccommodatesShiftType(
  shiftType: ScheduleRoomAssignment["shiftType"],
  availabilityOptions: AvailabilityOption[],
) {
  const shiftTypeIsAvailable = availabilityOptions.includes(shiftType);
  const fullShiftIsAvailable = availabilityOptions.includes("full_shift");
  const shiftTypeIsShorter = shiftType !== "full_shift";
  const fullShiftCanCover = fullShiftIsAvailable && shiftTypeIsShorter;
  const shiftTypeIsAccommodated = !shiftTypeIsAvailable && fullShiftCanCover;
  return shiftTypeIsAccommodated;
}

function shiftTypePairIsSplitDay(
  firstShiftType: ScheduleRoomAssignment["shiftType"],
  secondShiftType: ScheduleRoomAssignment["shiftType"],
) {
  const firstIsFirstHalf = firstShiftType === "first_half";
  const secondIsSecondHalf = secondShiftType === "second_half";
  const firstPairMatches = firstIsFirstHalf && secondIsSecondHalf;
  const firstIsSecondHalf = firstShiftType === "second_half";
  const secondIsFirstHalf = secondShiftType === "first_half";
  const secondPairMatches = firstIsSecondHalf && secondIsFirstHalf;
  const isSplitDayPair = firstPairMatches || secondPairMatches;
  return isSplitDayPair;
}

function overlappingAssignmentIsAllowed(
  requestCenterId: string,
  requestShiftType: ScheduleRoomAssignment["shiftType"],
  existingCenterId: string,
  existingShiftType: ScheduleRoomAssignment["shiftType"],
) {
  const centersMatch = requestCenterId === existingCenterId;

  if (!centersMatch) {
    return false;
  }

  const splitDayPair = shiftTypePairIsSplitDay(
    requestShiftType,
    existingShiftType,
  );
  return splitDayPair;
}

function assignmentsOverlap(
  firstAssignment: ScheduleRoomAssignment,
  secondAssignment: ScheduleRoomAssignment,
) {
  const firstRange = assignmentDateTimeRange(firstAssignment);
  const secondRange = assignmentDateTimeRange(secondAssignment);
  const firstStartTime = firstRange.startDateTime;
  const firstEndTime = firstRange.endDateTime;
  const secondStartTime = secondRange.startDateTime;
  const secondEndTime = secondRange.endDateTime;
  const startsBeforeSecondEnds = firstStartTime < secondEndTime;
  const endsAfterSecondStarts = firstEndTime > secondStartTime;
  const overlaps = startsBeforeSecondEnds && endsAfterSecondStarts;
  return overlaps;
}

function providerHasOverlappingAssignment(
  assignments: ScheduleRoomAssignment[],
  assignment: ScheduleRoomAssignment,
  providerId: string,
) {
  const overlappingAssignment = assignments.find((candidate) => {
    const isSameAssignment = candidate.id === assignment.id;
    const isProviderAssignment = candidate.providerId === providerId;
    const assignmentsAreOverlapping = assignmentsOverlap(
      assignment,
      candidate,
    );
    const overlapIsAllowed = overlappingAssignmentIsAllowed(
      assignment.centerId,
      assignment.shiftType,
      candidate.centerId,
      candidate.shiftType,
    );
    const shouldBlock = (
      !isSameAssignment
      && isProviderAssignment
      && assignmentsAreOverlapping
      && !overlapIsAllowed
    );
    return shouldBlock;
  });
  const hasOverlappingAssignment = overlappingAssignment !== undefined;
  return hasOverlappingAssignment;
}

function hasHardProviderReasons(reasons: ProviderIneligibilityReason[]) {
  const hardReasons = reasons.filter((reason) => {
    return reason.severity === "hard_violation";
  });
  const hasHardReasons = hardReasons.length > 0;
  return hasHardReasons;
}

function hasWarningProviderReasons(reasons: ProviderIneligibilityReason[]) {
  const warningReasons = reasons.filter((reason) => {
    return reason.severity === "warning";
  });
  const hasWarningReasons = warningReasons.length > 0;
  return hasWarningReasons;
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
    const reason = createHardProviderReason(
      "inactive_provider",
      "other_hard_constraint",
      "Provider is inactive.",
    );
    reasons.push(reason);
  }

  const hasCenterCredential = provider.credentialed_center_ids.includes(room.centerId);

  if (!hasCenterCredential) {
    const reason = createHardProviderReason(
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

    const reason = createHardProviderReason(
      "missing_required_skill",
      "missing_skill",
      "Missing required room type skill.",
    );
    reasons.push(reason);
  }

  if (room.mdOnly) {
    const providerIsDoctor = provider.provider_type === "doctor";

    if (!providerIsDoctor) {
      const reason = createHardProviderReason(
        "md_requirement_not_met",
        "md_requirement_not_met",
        "MD requirement not met.",
      );
      reasons.push(reason);
    }
  }

  const availabilityIsLoading = availability === undefined;

  if (availabilityIsLoading) {
    const reason = createHardProviderReason(
      "provider_availability_unset",
      "availability_conflict",
      "Provider availability is still loading.",
    );
    reasons.push(reason);
  } else {
    const availabilityIsUnset = availabilityOptions.includes("unset");

    if (availabilityIsUnset) {
      const reason = createHardProviderReason(
        "provider_availability_unset",
        "availability_conflict",
        "Provider has not supplied availability for this day.",
      );
      reasons.push(reason);
    }

    const providerIsUnavailable = availabilityOptions.includes("none");

    if (providerIsUnavailable) {
      const reason = createHardProviderReason(
        "provider_unavailable",
        "availability_conflict",
        "Provider is unavailable on this day.",
      );
      reasons.push(reason);
    }

    const hasWorkAvailability = !availabilityIsUnset && !providerIsUnavailable;
    const shiftTypeIsAvailable = availabilityOptions.includes(assignment.shiftType);
    const shiftTypeIsAccommodated = fullShiftAvailabilityAccommodatesShiftType(
      assignment.shiftType,
      availabilityOptions,
    );

    if (hasWorkAvailability && !shiftTypeIsAvailable && !shiftTypeIsAccommodated) {
      const reason = createHardProviderReason(
        "provider_shift_type_unavailable",
        "availability_conflict",
        "Provider availability does not include this shift type.",
      );
      reasons.push(reason);
    }

    if (hasWorkAvailability && shiftTypeIsAccommodated) {
      const reason = createWarningProviderReason(
        "full_shift_availability_accommodation",
        "shift_request_conflict",
        "Provider offered full-day availability and is accommodating a shorter shift.",
      );
      reasons.push(reason);
    }

  }

  const hasOverlappingAssignment = providerHasOverlappingAssignment(
    assignments,
    assignment,
    provider.id,
  );

  if (hasOverlappingAssignment) {
    const reason = createHardProviderReason(
      "provider_double_booked",
      "other_hard_constraint",
      "Provider is already assigned to an overlapping slot.",
    );
    reasons.push(reason);
  }

  const hasHardReasons = hasHardProviderReasons(reasons);
  const isEligible = !hasHardReasons;
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

function providerOptionHasReason(
  option: ProviderPickerOption,
  reasonCode: string,
) {
  const reason = option.reasons.find((candidate) => {
    return candidate.code === reasonCode;
  });
  const hasReason = reason !== undefined;
  return hasReason;
}

function providerOptionIsDoubleBooked(option: ProviderPickerOption) {
  const hasDoubleBooking = providerOptionHasReason(
    option,
    "provider_double_booked",
  );
  return hasDoubleBooking;
}

function providerOptionIsSelectable(option: ProviderPickerOption) {
  const hasDoubleBooking = providerOptionIsDoubleBooked(option);
  const isSelectable = !hasDoubleBooking;
  return isSelectable;
}

function providerOptionButtonClassName(
  isSelected: boolean,
  isSelectable: boolean,
) {
  if (!isSelectable) {
    return "w-full cursor-not-allowed rounded-md border border-red-200 bg-red-50 px-2 py-2 text-left opacity-75";
  }

  if (isSelected) {
    return "w-full rounded-md border border-teal-600 bg-teal-50 px-2 py-2 text-left";
  }

  return "w-full rounded-md border border-slate-200 bg-white px-2 py-2 text-left hover:bg-slate-50";
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

  const hasWarnings = hasWarningProviderReasons(option.reasons);

  if (hasWarnings) {
    return "warning";
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

  const hasWarnings = hasWarningProviderReasons(option.reasons);

  if (hasWarnings) {
    return "Eligible with warning";
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

  if (reason.code === "full_shift_availability_accommodation") {
    return "Availability accommodation";
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

      const severity: ConstraintSeverity =
        reason.severity === "warning" ? "Warning" : "Hard";
      const row = {
        id: `${assignment.id}-${reason.code}`,
        severity,
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

function providerNeedsAvailabilityReminder(
  availability: ProviderWeeklyAvailabilityRecord,
) {
  const requiredDays = availability.days.filter((day) => {
    const weekdayIsRequired = availabilityReminderWeekdays.includes(day.weekday);
    return weekdayIsRequired;
  });
  const providerSubmittedRequiredDay = requiredDays.some((day) => {
    const dayIsUnset = day.options.includes("unset");
    const dayWasSubmitted = !dayIsUnset;
    return dayWasSubmitted;
  });
  const needsReminder = !providerSubmittedRequiredDay;
  return needsReminder;
}

function providersNeedingAvailabilityReminder(
  providers: Provider[],
  availabilityByProviderId: Map<string, ProviderWeeklyAvailabilityRecord>,
) {
  const providersNeedingReminder = providers.filter((provider) => {
    const availability = availabilityByProviderId.get(provider.id);

    if (availability === undefined) {
      return false;
    }

    const needsReminder = providerNeedsAvailabilityReminder(availability);
    return needsReminder;
  });
  return providersNeedingReminder;
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
  schedulePeriod: SchedulePeriod,
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
    slotDate: slotDateForDayKey(schedulePeriod, targetDayKey),
    slotDateChanged: true,
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
  schedulePeriod: SchedulePeriod,
  dayKey: ScheduleDayKey,
  sortOrder: number,
): ScheduleRoomAssignment {
  const assignment: ScheduleRoomAssignment = {
    id: createAssignmentId(),
    dayKey,
    slotDate: slotDateForDayKey(schedulePeriod, dayKey),
    slotDateChanged: false,
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

function templatePayloadFromAssignments(
  name: string,
  assignments: ScheduleRoomAssignment[],
): ScheduleStructureTemplateSavePayload {
  const slots = assignments.map((assignment) => {
    const slot = {
      weekday: assignment.dayKey,
      room_id: assignment.roomId,
      shift_type: assignment.shiftType,
      start_time: assignment.startTime,
      end_time: assignment.endTime,
      display_order: assignment.sortOrder,
    };
    return slot;
  });
  const payload = {
    name,
    slots,
  };
  return payload;
}

function assignmentFromAppliedTemplateSlot(
  slot: ScheduleStructureTemplateApplyResponse["applied_slots"][number],
): ScheduleRoomAssignment {
  const assignment: ScheduleRoomAssignment = {
    id: slot.room_slot_id,
    dayKey: slot.weekday,
    slotDate: slot.schedule_date,
    slotDateChanged: false,
    centerId: slot.center_id,
    roomId: slot.room_id,
    shiftType: slot.shift_type,
    providerId: null,
    startTime: timeLabelFromDateTime(slot.start_time),
    endTime: timeLabelFromDateTime(slot.end_time),
    sortOrder: slot.display_order,
    validationStatus: "unknown",
    validationMessages: [],
  };
  return assignment;
}

function upsertTemplateOption(
  templates: ScheduleStructureTemplate[],
  nextTemplate: ScheduleStructureTemplate,
) {
  const otherTemplates = templates.filter((template) => {
    const isSameTemplate = template.id === nextTemplate.id;
    return !isSameTemplate;
  });
  const nextTemplates = [...otherTemplates, nextTemplate];
  const sortedTemplates = nextTemplates.toSorted((first, second) => {
    const comparison = first.name.localeCompare(second.name);
    return comparison;
  });
  return sortedTemplates;
}

export function ScheduleWorkspace({
  initialVersionDetail,
  initialTemplates,
  initialVersions,
  providers,
  rooms,
  schedulePeriod,
  scheduleId,
}: ScheduleWorkspaceProps) {
  const { dismissToast, showToast } = useToast();
  const router = useRouter();
  const pendingNavigationToastId = useRef<string | null>(null);
  const saveWorkingDraftRef = useRef<() => Promise<boolean>>(async () => {
    return false;
  });
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
  const [versionOptions, setVersionOptions] =
    useState<PersistedScheduleVersion[]>(initialVersions);
  const [templateOptions, setTemplateOptions] =
    useState<ScheduleStructureTemplate[]>(initialTemplates);
  const [selectedVersionId, setSelectedVersionId] = useState(() => {
    const versionId = initialVersionDetail?.version.id ?? "";
    return versionId;
  });
  const [selectedTemplateId, setSelectedTemplateId] = useState(() => {
    const templateId = initialTemplates.at(0)?.id ?? "";
    return templateId;
  });
  const [templateName, setTemplateName] = useState("");
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [isLoadingTemplate, setIsLoadingTemplate] = useState(false);
  const [isDeletingTemplate, setIsDeletingTemplate] = useState(false);
  const [isLoadingVersion, setIsLoadingVersion] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [showWeekends, setShowWeekends] = useState(false);
  const [showAvailabilityReminderProviders, setShowAvailabilityReminderProviders] = useState(false);
  const [compactModeEnabled, setCompactModeEnabled] = useState(false);
  const [openProviderAssignmentId, setOpenProviderAssignmentId] = useState<
    string | null
  >(null);
  const [openShiftTypeAssignmentId, setOpenShiftTypeAssignmentId] = useState<
    string | null
  >(null);
  const [availabilityByProviderId, setAvailabilityByProviderId] = useState<
    Map<string, ProviderWeeklyAvailabilityRecord>
  >(() => new Map());
  const [availabilityLoadMessage, setAvailabilityLoadMessage] = useState<string | null>(null);
  const [dropIndicator, setDropIndicator] = useState<DropIndicator | null>(null);

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
        showToast({
          title: "Availability load failed",
          description: "Provider availability could not be loaded for this schedule.",
          tone: "error",
        });
      }
    }

    loadWeeklyAvailability();

    return () => {
      isMounted = false;
    };
  }, [providers, scheduleId, showToast]);

  const visibleColumns = dayColumns.filter((column) => {
    const shouldShowColumn = showWeekends || !column.isWeekend;
    return shouldShowColumn;
  });
  const latestPublishEvent = publishEvents.at(-1);
  const assignedRoomCount = workingVersion.assignments.length;
  const providerAssignedRooms = workingVersion.assignments.filter((assignment) => {
    return assignment.providerId !== null;
  });
  const assignedProviderCount = providerAssignedRooms.length;
  const lastPublishedLabel =
    latestPublishEvent === undefined
      ? "Not published yet"
      : formatTimelineDate(latestPublishEvent.publishedAt);

  function updateWorkingVersion(nextVersion: ScheduleVersion) {
    setWorkingVersion(nextVersion);
  }

  function handleNotesChanged(notes: string) {
    const nextVersion = scheduleVersionSchema.parse({
      ...workingVersion,
      notes,
    });
    updateWorkingVersion(nextVersion);
  }

  async function handleSaveTemplate() {
    const normalizedName = templateName.trim();
    const hasTemplateName = normalizedName.length > 0;

    if (!hasTemplateName) {
      showToast({
        title: "Template name required",
        description: "Enter a template name before saving.",
        tone: "warning",
      });
      return;
    }

    if (workingVersion.assignments.length === 0) {
      showToast({
        title: "Template is empty",
        description: "Add rooms to the board before saving a template.",
        tone: "warning",
      });
      return;
    }

    const existingTemplate = templateOptions.find((template) => {
      return template.name === normalizedName;
    });

    if (existingTemplate !== undefined) {
      const shouldUpdate = window.confirm(
        "Update the existing schedule structure template with this name?",
      );

      if (!shouldUpdate) {
        return;
      }
    }

    const payload = templatePayloadFromAssignments(
      normalizedName,
      workingVersion.assignments,
    );
    setIsSavingTemplate(true);

    try {
      const savedTemplate =
        existingTemplate === undefined
          ? await createScheduleStructureTemplate(payload)
          : await updateScheduleStructureTemplate(existingTemplate.id, payload);
      setTemplateOptions((currentTemplates) => {
        const nextTemplates = upsertTemplateOption(currentTemplates, savedTemplate);
        return nextTemplates;
      });
      setSelectedTemplateId(savedTemplate.id);
      setTemplateName(savedTemplate.name);
      setActionMessage("Schedule template saved.");
      showToast({
        title: "Template saved",
        description: "The schedule structure template was saved.",
        tone: "success",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Template save failed.";
      setActionMessage(message);
      showToast({
        title: "Template save failed",
        description: message,
        tone: "error",
      });
    } finally {
      setIsSavingTemplate(false);
    }
  }

  async function handleLoadTemplate() {
    const hasSelectedTemplate = selectedTemplateId.length > 0;

    if (!hasSelectedTemplate) {
      showToast({
        title: "Select a template",
        description: "Choose a schedule structure template before loading.",
        tone: "warning",
      });
      return;
    }

    setIsLoadingTemplate(true);

    try {
      const response = await applyScheduleStructureTemplate(
        selectedTemplateId,
        scheduleId,
      );
      const templateAssignments = response.applied_slots.map((slot) => {
        const assignment = assignmentFromAppliedTemplateSlot(slot);
        return assignment;
      });
      const reorderedAssignments = reorderAssignments(templateAssignments);
      const nextVersion = scheduleVersionSchema.parse({
        ...workingVersion,
        status: "working",
        assignments: reorderedAssignments,
      });
      const appliedSlotCount = response.applied_slots.length;
      const skippedSlotCount = response.skipped_slots.length;
      updateWorkingVersion(nextVersion);
      setSavedVersionDetail(null);
      setSelectedVersionId("");
      setActionMessage("Schedule template loaded.");
      showToast({
        title: "Template loaded",
        description: `${appliedSlotCount} room slots were loaded.`,
        tone: "success",
      });

      if (skippedSlotCount > 0) {
        showToast({
          title: "Some rooms were skipped",
          description: `${skippedSlotCount} unavailable room slots were skipped.`,
          tone: "warning",
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Template load failed.";
      setActionMessage(message);
      showToast({
        title: "Template load failed",
        description: message,
        tone: "error",
      });
    } finally {
      setIsLoadingTemplate(false);
    }
  }

  async function handleDeleteTemplate() {
    const selectedTemplate = templateOptions.find((template) => {
      return template.id === selectedTemplateId;
    });

    if (selectedTemplate === undefined) {
      showToast({
        title: "Select a template",
        description: "Choose a schedule structure template before deleting.",
        tone: "warning",
      });
      return;
    }

    const shouldDelete = window.confirm(
      `Delete the ${selectedTemplate.name} schedule structure template?`,
    );

    if (!shouldDelete) {
      return;
    }

    setIsDeletingTemplate(true);

    try {
      await deleteScheduleStructureTemplate(selectedTemplate.id);
      setTemplateOptions((currentTemplates) => {
        const nextTemplates = currentTemplates.filter((template) => {
          return template.id !== selectedTemplate.id;
        });
        return nextTemplates;
      });
      setSelectedTemplateId("");
      setActionMessage("Schedule template deleted.");
      showToast({
        title: "Template deleted",
        description: "The schedule structure template was deleted.",
        tone: "success",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Template delete failed.";
      setActionMessage(message);
      showToast({
        title: "Template delete failed",
        description: message,
        tone: "error",
      });
    } finally {
      setIsDeletingTemplate(false);
    }
  }

  function savePayloadFromAssignments(
    assignments: ScheduleRoomAssignment[],
  ): ScheduleAssignmentSavePayload[] {
    const payload = assignments.map((assignment) => {
      const dateTimeRange = assignmentDateTimeRange(assignment);
      const startTime = dateTimeRange.startDateTime;
      const endTime = dateTimeRange.endDateTime;
      const assignmentPayload = {
        room_slot_id: assignment.id,
        allow_slot_date_change: assignment.slotDateChanged,
        provider_id: assignment.providerId,
        center_id: assignment.centerId,
        room_id: assignment.roomId,
        shift_requirement_id: null,
        required_provider_type: null,
        shift_type: assignment.shiftType,
        schedule_date: assignment.slotDate,
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
      showToast({
        title: "Publish blocked",
        description: "Resolve publish blockers before publishing.",
        tone: "warning",
      });
      return;
    }

    if (savedVersionDetail === null) {
      setActionMessage("Save a draft before publishing.");
      showToast({
        title: "Publish blocked",
        description: "Save a draft before publishing.",
        tone: "warning",
      });
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
      setVersionOptions((currentOptions) => {
        const nextOptions = upsertVersionOption(currentOptions, response.version);
        return nextOptions;
      });
      trackSchedulePublished({
        schedulePeriodId: scheduleId,
        scheduleVersionId: response.version.id,
      });
      setActionMessage("Schedule published.");
      showToast({
        title: "Schedule published",
        description: "The saved schedule version is now published.",
        tone: "success",
      });
    } catch (error) {
      captureScheduleWorkflowException({
        workflowName: "publish_schedule_version",
        error,
      });
      const message =
        error instanceof Error
          ? error.message
          : "Publish failed because the saved version has blockers.";
      setActionMessage(message);
      showToast({
        title: "Publish failed",
        description: message,
        tone: "error",
      });
    } finally {
      setIsPublishing(false);
    }
  }

  async function saveWorkingDraft() {
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
      notes: scheduleNotesPayload(workingVersion.notes),
      assignments: savePayload,
    };

    setIsSaving(true);
    setActionMessage(null);
    updateWorkingVersion(validatedVersion);
    let draftWasSaved = false;

    try {
      const detail = await saveDraftScheduleVersion(payload);
      const nextVersion = versionFromDetail(schedulePeriod, detail);
      setSavedVersionDetail(detail);
      setSelectedVersionId(detail.version.id);
      setVersionOptions((currentOptions) => {
        const nextOptions = upsertVersionOption(currentOptions, detail.version);
        return nextOptions;
      });
      updateWorkingVersion(nextVersion);
      trackScheduleDraftSaved({
        schedulePeriodId: scheduleId,
        scheduleVersionId: detail.version.id,
        assignmentCount: detail.assignments.length,
      });
      setActionMessage("Draft saved.");
      showToast({
        title: "Draft saved",
        description: "Your schedule changes were saved.",
        tone: "success",
      });
      draftWasSaved = true;
    } catch (error) {
      captureScheduleWorkflowException({
        workflowName: "save_schedule_draft",
        error,
      });
      const message = error instanceof Error ? error.message : "Draft save failed.";
      setActionMessage(message);
      showToast({
        title: "Draft save failed",
        description: message,
        tone: "error",
      });
    } finally {
      setIsSaving(false);
    }

    return draftWasSaved;
  }

  async function handleSaveDraft() {
    await saveWorkingDraft();
  }

  useEffect(() => {
    saveWorkingDraftRef.current = saveWorkingDraft;
  });

  async function handleGenerateSchedule(generationMode: "strict" | "best_effort") {
    const parentVersionId =
      savedVersionDetail === null ? null : savedVersionDetail.version.id;
    const payload = {
      parent_schedule_version_id: parentVersionId,
      notes: scheduleNotesPayload(workingVersion.notes),
      assignments: savePayloadFromAssignments(workingVersion.assignments),
      generation_mode: generationMode,
    };
    const generationTitle =
      generationMode === "strict" ? "Strict generation started" : "Best-effort generation started";
    const generationDescription =
      generationMode === "strict"
        ? "The solver is building a complete draft schedule."
        : "The solver is building the most complete valid draft schedule it can.";

    setIsGenerating(true);
    setActionMessage(null);
    showToast({
      title: generationTitle,
      description: generationDescription,
      tone: "info",
    });

    try {
      const detail = await generateScheduleVersion(scheduleId, payload);
      const generatedAssignmentCount = detail.assignments.length;
      const currentAssignmentCount = workingVersion.assignments.length;
      const wouldClearWorkingSchedule =
        generatedAssignmentCount === 0 && currentAssignmentCount > 0;

      if (wouldClearWorkingSchedule) {
        setActionMessage("Generation produced no assignments, so the current board was kept.");
        showToast({
          title: "Generation returned no assignments",
          description: "The current board was kept.",
          tone: "warning",
        });
        return;
      }

      const generatedVersion = versionFromDetail(schedulePeriod, detail);
      const nextVersion =
        generationMode === "best_effort"
          ? versionWithPreservedBestEffortSlots(workingVersion, generatedVersion)
          : generatedVersion;
      const duration = detail.metrics.solve_duration_ms;
      setSavedVersionDetail(detail);
      setSelectedVersionId(detail.version.id);
      setVersionOptions((currentOptions) => {
        const nextOptions = upsertVersionOption(currentOptions, detail.version);
        return nextOptions;
      });
      updateWorkingVersion(nextVersion);
      trackScheduleGenerated({
        schedulePeriodId: scheduleId,
        scheduleVersionId: detail.version.id,
        assignmentCount: detail.assignments.length,
        solveDurationMs: duration,
      });
      const generatedWithViolations = !detail.is_feasible;

      if (generatedWithViolations) {
        setActionMessage(`Generated best-effort draft in ${duration} ms with violations.`);
        showToast({
          title: "Best-effort draft generated",
          description: `Generated partial draft in ${duration} ms with ${detail.violations.length} violations.`,
          tone: "warning",
        });
      } else {
        setActionMessage(`Generated draft in ${duration} ms.`);
        showToast({
          title: "Draft generated",
          description: `Generated draft in ${duration} ms.`,
          tone: "success",
        });
      }
    } catch (error) {
      captureScheduleWorkflowException({
        workflowName: "generate_schedule_version",
        error,
      });
      const message =
        error instanceof Error
          ? error.message
          : "Schedule generation could not satisfy all constraints.";
      setActionMessage(message);
      showToast({
        title: "Generation failed",
        description: message,
        tone: "error",
      });
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleVersionSelected(versionId: string) {
    setSelectedVersionId(versionId);
    setIsLoadingVersion(true);
    setActionMessage(null);

    try {
      const detail = await getScheduleVersion(versionId);
      const nextVersion = versionFromDetail(schedulePeriod, detail);
      const nextPublishEvents = publishEventsFromDetail(detail);
      setSavedVersionDetail(detail);
      setPublishEvents(nextPublishEvents);
      updateWorkingVersion(nextVersion);
      setActionMessage("Draft loaded.");
      showToast({
        title: "Draft loaded",
        description: "The selected schedule draft is now open.",
        tone: "success",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Draft load failed.";
      setActionMessage(message);
      showToast({
        title: "Draft load failed",
        description: message,
        tone: "error",
      });
    } finally {
      setIsLoadingVersion(false);
    }
  }

  function handleDragStart(event: React.DragEvent, payload: DragPayload) {
    const payloadText = JSON.stringify(payload);
    event.dataTransfer.setData("application/json", payloadText);
    event.dataTransfer.effectAllowed = "move";
  }

  function handleDropIndicatorSet(dayKey: ScheduleDayKey, targetIndex: number) {
    const nextIndicator: DropIndicator = {
      dayKey,
      targetIndex,
    };
    setDropIndicator(nextIndicator);
  }

  function handleDropIndicatorCleared() {
    setDropIndicator(null);
  }

  function handleDropOnColumn(event: React.DragEvent, dayKey: ScheduleDayKey) {
    event.preventDefault();
    handleDropIndicatorCleared();

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
      const assignment = createRoomAssignment(
        room,
        schedulePeriod,
        dayKey,
        sortOrder,
      );
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
      schedulePeriod,
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
    handleDropIndicatorCleared();

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

      const assignment = createRoomAssignment(
        room,
        schedulePeriod,
        dayKey,
        targetIndex,
      );
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
      schedulePeriod,
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

  function handleReorderAssignment(
    assignmentId: string,
    dayKey: ScheduleDayKey,
    direction: "up" | "down",
  ) {
    const dayAssignments = assignmentsForKey(workingVersion.assignments, dayKey);
    const currentIndex = dayAssignments.findIndex((assignment) => {
      return assignment.id === assignmentId;
    });

    if (currentIndex < 0) {
      return;
    }

    const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    const targetIsBeforeStart = targetIndex < 0;
    const targetIsAfterEnd = targetIndex >= dayAssignments.length;

    if (targetIsBeforeStart || targetIsAfterEnd) {
      return;
    }

    const draggedAssignment = {
      assignmentId,
      dayKey,
    };
    const assignments = moveAssignment(
      workingVersion.assignments,
      draggedAssignment,
      schedulePeriod,
      dayKey,
      targetIndex,
    );
    const nextVersion = scheduleVersionSchema.parse({
      ...workingVersion,
      assignments,
    });
    updateWorkingVersion(nextVersion);
  }

  function dropIndicatorMatches(dayKey: ScheduleDayKey, targetIndex: number) {
    if (dropIndicator === null) {
      return false;
    }

    const dayKeyMatches = dropIndicator.dayKey === dayKey;

    if (!dayKeyMatches) {
      return false;
    }

    const targetIndexMatches = dropIndicator.targetIndex === targetIndex;
    return targetIndexMatches;
  }

  function handleClearProviderAssignments() {
    const shouldClearProviderAssignments = window.confirm(
      "Clear all provider assignments while keeping the room schedule structure?",
    );

    if (!shouldClearProviderAssignments) {
      return;
    }

    const option = null;
    const validationStatus = validationStatusForSelection(option);
    const validationMessages = validationMessagesForSelection(option);
    const assignments = workingVersion.assignments.map((assignment) => {
      const nextAssignment = {
        ...assignment,
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
    setActionMessage("Provider assignments cleared.");
    showToast({
      title: "Provider assignments cleared",
      description: "Rooms stayed on the schedule.",
      tone: "success",
    });
  }

  function handleClearRooms() {
    const shouldClearRooms = window.confirm(
      "Clear all rooms from the schedule, including their provider assignments?",
    );

    if (!shouldClearRooms) {
      return;
    }

    const assignments: ScheduleRoomAssignment[] = [];
    const nextVersion = scheduleVersionSchema.parse({
      ...workingVersion,
      assignments,
    });
    updateWorkingVersion(nextVersion);
    setOpenProviderAssignmentId(null);
    setOpenShiftTypeAssignmentId(null);
    setActionMessage("Rooms cleared from the schedule.");
    showToast({
      title: "Rooms cleared",
      description: "All room slots were removed from the schedule.",
      tone: "success",
    });
  }

  function handleClearDayAssignments(dayKey: ScheduleDayKey) {
    const remainingAssignments = workingVersion.assignments.filter((assignment) => {
      return assignment.dayKey !== dayKey;
    });
    const reorderedAssignments = reorderAssignments(remainingAssignments);
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
    setOpenShiftTypeAssignmentId(null);
  }

  function handleShiftTypePickerToggled(assignmentId: string) {
    const assignmentIsOpen = openShiftTypeAssignmentId === assignmentId;
    const nextAssignmentId = assignmentIsOpen ? null : assignmentId;
    setOpenShiftTypeAssignmentId(nextAssignmentId);
  }

  function savedAssignmentIdForRequest(assignment: ScheduleRoomAssignment) {
    const savedAssignment = savedVersionDetail?.assignments.find((candidate) => {
      return candidate.room_slot_id === assignment.id;
    });
    const assignmentId = savedAssignment?.id ?? null;
    return assignmentId;
  }

  async function verifiedProviderOption(
    assignment: ScheduleRoomAssignment,
    option: ProviderPickerOption,
  ) {
    const startTime = dateTimeForAssignment(
      assignment.slotDate,
      assignment.startTime,
    );
    const endTime = dateTimeForAssignment(
      assignment.slotDate,
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
      showToast({
        title: "Provider check failed",
        description: "Provider eligibility could not be verified.",
        tone: "warning",
      });
      const reason = createHardProviderReason(
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
    const optionIsSelectable = providerOptionIsSelectable(selectedOption);

    if (!optionIsSelectable) {
      setActionMessage("Provider is already assigned to an overlapping slot.");
      showToast({
        title: "Provider not assigned",
        description: "Provider is already assigned to an overlapping slot.",
        tone: "warning",
      });
      setOpenProviderAssignmentId(null);
      return;
    }

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
  const availabilityReminderProviders = providersNeedingAvailabilityReminder(
    providers,
    availabilityByProviderId,
  );
  const availabilityLoadIsComplete = availabilityByProviderId.size === providers.length;
  const availabilityReminderProviderCount = availabilityReminderProviders.length;
  const currentDraftSnapshot = useMemo(() => {
    const snapshot = scheduleDraftSnapshot(workingVersion);
    return snapshot;
  }, [workingVersion]);
  const savedDraftSnapshot = useMemo(() => {
    if (savedVersionDetail === null) {
      return emptyScheduleDraftSnapshot;
    }

    const savedVersion = versionFromDetail(schedulePeriod, savedVersionDetail);
    const snapshot = scheduleDraftSnapshot(savedVersion);
    return snapshot;
  }, [savedVersionDetail, schedulePeriod]);
  const scheduleDraftIsSaved = scheduleDraftSnapshotsMatch(
    currentDraftSnapshot,
    savedDraftSnapshot,
  );
  const hasUnsavedScheduleChanges = !scheduleDraftIsSaved;
  const canPublish =
    publishBlockerCount === 0 && assignedRoomCount > 0 && hasSavedVersion;
  const hasSelectedTemplate = selectedTemplateId.length > 0;
  const canLoadTemplate = hasSelectedTemplate && !isLoadingTemplate;
  const canDeleteTemplate = hasSelectedTemplate && !isDeletingTemplate;

  useEffect(() => {
    if (!hasUnsavedScheduleChanges) {
      const toastId = pendingNavigationToastId.current;

      if (toastId !== null) {
        dismissToast(toastId);
        pendingNavigationToastId.current = null;
      }

      return;
    }

    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [dismissToast, hasUnsavedScheduleChanges]);

  useEffect(() => {
    if (!hasUnsavedScheduleChanges) {
      return;
    }

    function clearPendingNavigationToast() {
      const toastId = pendingNavigationToastId.current;

      if (toastId === null) {
        return;
      }

      dismissToast(toastId);
      pendingNavigationToastId.current = null;
    }

    function keepEditingSchedule() {
      pendingNavigationToastId.current = null;
    }

    function discardDraftAndNavigateToHref(href: string) {
      pendingNavigationToastId.current = null;
      router.push(href);
    }

    async function saveDraftAndNavigateToHref(href: string) {
      pendingNavigationToastId.current = null;

      const draftWasSaved = await saveWorkingDraftRef.current();

      if (!draftWasSaved) {
        return;
      }

      router.push(href);
    }

    function showUnsavedNavigationPrompt(href: string) {
      clearPendingNavigationToast();

      const toastId = showToast({
        title: "Unsaved schedule changes",
        description: "Save this draft before leaving, or discard the working changes.",
        tone: "warning",
        durationMs: null,
        actions: [
          {
            label: "Save",
            tone: "primary",
            onClick: () => saveDraftAndNavigateToHref(href),
          },
          {
            label: "Discard",
            tone: "danger",
            onClick: () => discardDraftAndNavigateToHref(href),
          },
          {
            label: "Keep editing",
            tone: "secondary",
            onClick: keepEditingSchedule,
          },
        ],
      });
      pendingNavigationToastId.current = toastId;
    }

    function handleDocumentClick(event: MouseEvent) {
      const href = navigationHrefFromClickEvent(event);

      if (href === null) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      showUnsavedNavigationPrompt(href);
    }

    document.addEventListener("click", handleDocumentClick, true);

    return () => {
      document.removeEventListener("click", handleDocumentClick, true);
    };
  }, [dismissToast, hasUnsavedScheduleChanges, router, showToast]);

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
                    ? `${availabilityReminderProviderCount} out of ${providers.length} Providers need availability follow-up.`
                    : "Checking provider availability..."}
                </p>
                {availabilityReminderProviderCount > 0 ? (
                  <button
                    type="button"
                    onClick={() =>
                      setShowAvailabilityReminderProviders((currentValue) => !currentValue)
                    }
                    className="text-sm font-semibold text-teal-700 hover:text-teal-900"
                  >
                    {showAvailabilityReminderProviders ? "Hide providers" : "Show providers"}
                  </button>
                ) : null}
              </div>
              {showAvailabilityReminderProviders && availabilityReminderProviderCount > 0 ? (
                <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                  <ul className="flex flex-wrap gap-2">
                    {availabilityReminderProviders.map((provider) => {
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
          <div className="flex w-full flex-col gap-3 xl:w-auto xl:items-end">
            <div className="flex flex-wrap gap-2 xl:justify-end">
              <label className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700">
                <span>Layout</span>
                <select
                  value={compactModeEnabled ? "compact" : "full"}
                  onChange={(event) => setCompactModeEnabled(event.target.value === "compact")}
                  className="bg-white text-sm font-semibold text-slate-900 outline-none"
                >
                  <option value="full">Full mode</option>
                  <option value="compact">Compact mode</option>
                </select>
              </label>
              {versionOptions.length > 0 ? (
                <label className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700">
                  <span>Version</span>
                  <select
                    value={selectedVersionId}
                    onChange={(event) => handleVersionSelected(event.target.value)}
                    disabled={isLoadingVersion}
                    className="bg-white text-sm font-semibold text-slate-900 outline-none disabled:text-slate-400"
                  >
                    {selectedVersionId === "" ? (
                      <option value="">Working version</option>
                    ) : null}
                    {versionOptions.map((version) => {
                      const label = versionOptionLabel(version);
                      return (
                        <option key={version.id} value={version.id}>
                          {label}
                        </option>
                      );
                    })}
                  </select>
                </label>
              ) : null}
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
                onClick={() => handleGenerateSchedule("strict")}
                disabled={isGenerating}
                className="inline-flex h-9 items-center justify-center rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100"
              >
                {isGenerating ? "Running solver" : "Solve - Strict"}
              </button>
              <button
                type="button"
                onClick={() => handleGenerateSchedule("best_effort")}
                disabled={isGenerating}
                className="inline-flex h-9 items-center justify-center rounded-md border border-teal-300 px-3 text-sm font-semibold text-teal-800 hover:bg-teal-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
              >
                {isGenerating ? "Running solver" : "Solve - Best Effort"}
              </button>
              <button
                type="button"
                onClick={handleClearProviderAssignments}
                disabled={assignedProviderCount === 0}
                className="inline-flex h-9 items-center justify-center rounded-md border border-red-300 px-3 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
              >
                Clear assignments
              </button>
              <button
                type="button"
                onClick={handleClearRooms}
                disabled={assignedRoomCount === 0}
                className="inline-flex h-9 items-center justify-center rounded-md border border-red-300 px-3 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
              >
                Clear rooms
              </button>
            </div>
            <div className="flex w-full flex-wrap gap-2 rounded-md border border-teal-200 bg-teal-50 p-2 xl:w-auto xl:justify-end">
              <button
                type="button"
                onClick={handleSaveDraft}
                disabled={isSaving}
                className="inline-flex h-9 items-center justify-center rounded-md border border-teal-300 bg-white px-3 text-sm font-semibold text-teal-800 hover:bg-teal-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
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
        </div>
        <div className="mt-4 border-t border-slate-200 pt-4">
          <h4 className="text-sm font-semibold text-slate-950">
            Schedule templates
          </h4>
          <div className="mt-3 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
            <div className="flex flex-1 flex-col gap-3 md:flex-row md:items-end">
              <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm font-medium text-slate-700">
                <span>Template name</span>
                <input
                  type="text"
                  value={templateName}
                  onChange={(event) => setTemplateName(event.target.value)}
                  className="h-9 rounded-md border border-slate-300 px-3 text-sm text-slate-900 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
                />
              </label>
              <button
                type="button"
                onClick={handleSaveTemplate}
                disabled={isSavingTemplate}
                className="inline-flex h-9 items-center justify-center rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100"
              >
                {isSavingTemplate ? "Saving template" : "Save template"}
              </button>
            </div>
            <div className="flex flex-1 flex-col gap-3 md:flex-row md:items-end xl:justify-end">
              <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm font-medium text-slate-700 xl:max-w-sm">
                <span>Load template</span>
                <select
                  value={selectedTemplateId}
                  onChange={(event) => setSelectedTemplateId(event.target.value)}
                  className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
                >
                  <option value="">Select template</option>
                  {templateOptions.map((template) => {
                    return (
                      <option key={template.id} value={template.id}>
                        {template.name}
                      </option>
                    );
                  })}
                </select>
              </label>
              <button
                type="button"
                onClick={handleLoadTemplate}
                disabled={!canLoadTemplate}
                className="inline-flex h-9 items-center justify-center rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100"
              >
                {isLoadingTemplate ? "Loading" : "Load"}
              </button>
              <button
                type="button"
                onClick={handleDeleteTemplate}
                disabled={!canDeleteTemplate}
                className="inline-flex h-9 items-center justify-center rounded-md border border-red-300 px-3 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
              >
                {isDeletingTemplate ? "Deleting" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      </section>
      <section className="rounded-md border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3">
          <h3 className="text-base font-semibold text-slate-950">
            Freeform notes
          </h3>
        </div>
        <div className="p-4">
          <textarea
            value={workingVersion.notes}
            onChange={(event) => handleNotesChanged(event.target.value)}
            rows={5}
            className="min-h-32 w-full resize-y rounded-md border border-slate-300 px-3 py-2 text-sm leading-6 text-slate-900 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
            aria-label="Freeform notes"
          />
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
              const dayDate = dateForDayKey(schedulePeriod, column.key);
              const dayDateLabel = formatDayHeaderDate(dayDate);
              return (
                <div
                  key={column.key}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => handleDropOnColumn(event, column.key)}
                  onDragLeave={handleDropIndicatorCleared}
                  className="flex min-h-96 min-w-52 flex-col rounded-md border border-slate-200 bg-slate-50"
                >
                  <div className="border-b border-slate-200 px-3 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h4 className="text-sm font-semibold text-slate-950">
                          <span className="block">{column.label}</span>
                          <span className="text-[11px] font-medium leading-4 text-slate-500">
                            ({dayDateLabel})
                          </span>
                        </h4>
                        <p className="text-xs text-slate-500">
                          {dayAssignments.length} rooms
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleClearDayAssignments(column.key)}
                        disabled={dayAssignments.length === 0}
                        className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                      >
                        Clear day
                      </button>
                    </div>
                  </div>
                  <div
                    className="flex flex-1 flex-col gap-2 p-2"
                    onDragOver={(event) => {
                      event.preventDefault();
                      const appendIndex = dayAssignments.length;
                      handleDropIndicatorSet(column.key, appendIndex);
                    }}
                  >
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
                      const selectedProviderIsMissing = selectedOption === null;
                      const selectedStatusIsValid = selectedStatus === "valid";
                      const selectedStatusIsInvalid = selectedStatus === "invalid";
                      const selectedStatusIsWarning =
                        selectedStatus === "warning" && !selectedProviderIsMissing;
                      const selectedStatusLabel = selectedStatusIsValid
                        ? "Eligible"
                        : selectedStatusIsWarning
                          ? "Warning"
                          : "Not publishable";
                      const selectedStatusClassName = selectedStatusIsValid
                        ? "rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700"
                        : "rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800";
                      const selectedMessageClassName =
                        selectedStatusIsInvalid || selectedProviderIsMissing
                          ? "text-xs leading-5 text-red-700"
                          : "text-xs leading-5 text-amber-700";
                      const providerPickerIsOpen =
                        openProviderAssignmentId === assignment.id;
                      const providerPickerLabel =
                        providerPickerButtonLabel(selectedOption);
                      const providerPickerStatus =
                        providerPickerStatusLabel(selectedOption);
                      const providerSelectionShouldShow = !compactModeEnabled;
                      const assignmentContainerClassName = shiftTypeContainerClassName(
                        assignment.shiftType,
                      );
                      const shiftTypePickerIsOpen =
                        openShiftTypeAssignmentId === assignment.id;
                      const assignmentUsesFullShift =
                        assignment.shiftType === "full_shift";
                      const shiftTypePickerShouldShow =
                        shiftTypePickerIsOpen || !assignmentUsesFullShift;
                      const assignmentShiftTypeLabel = shiftTypeLabel(
                        assignment.shiftType,
                      );
                      const moveUpDisabled = index === 0;
                      const moveDownDisabled = index === dayAssignments.length - 1;
                      return (
                        <div key={assignment.id} className="flex flex-col gap-2">
                          {dropIndicatorMatches(column.key, index) ? (
                            <div className="h-1 rounded bg-teal-600" aria-hidden="true" />
                          ) : null}
                          <div
                            draggable
                            onDragStart={(event) =>
                              handleDragStart(event, {
                                type: "scheduled-room",
                                assignmentId: assignment.id,
                                dayKey: column.key,
                              })
                            }
                            onDragOver={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              handleDropIndicatorSet(column.key, index);
                            }}
                            onDrop={(event) =>
                              handleDropOnAssignment(event, column.key, index)
                            }
                            className={assignmentContainerClassName}
                          >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="text-sm font-semibold text-slate-950">
                                {centerName}
                              </p>
                              <p className="text-xs text-slate-500">{roomName}</p>
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() =>
                                  handleReorderAssignment(
                                    assignment.id,
                                    column.key,
                                    "up",
                                  )
                                }
                                disabled={moveUpDisabled}
                                className="rounded-md px-1.5 py-0.5 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:cursor-not-allowed disabled:text-slate-300"
                                aria-label={`Move ${roomName} up`}
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  handleReorderAssignment(
                                    assignment.id,
                                    column.key,
                                    "down",
                                  )
                                }
                                disabled={moveDownDisabled}
                                className="rounded-md px-1.5 py-0.5 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:cursor-not-allowed disabled:text-slate-300"
                                aria-label={`Move ${roomName} down`}
                              >
                                ↓
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteAssignment(assignment.id)}
                                className="rounded-md px-2 text-sm font-semibold text-slate-500 hover:bg-red-50 hover:text-red-700"
                                aria-label={`Remove ${roomName}`}
                              >
                                x
                              </button>
                            </div>
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
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-xs font-semibold uppercase text-slate-500">
                                Shift type
                              </p>
                              {assignmentUsesFullShift ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleShiftTypePickerToggled(assignment.id)
                                  }
                                  aria-expanded={shiftTypePickerShouldShow}
                                  aria-label={`Edit shift type for ${roomName}`}
                                  className="rounded-md px-2 text-sm font-semibold leading-5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                                >
                                  ...
                                </button>
                              ) : null}
                            </div>
                            {shiftTypePickerShouldShow ? (
                              <select
                                value={assignment.shiftType}
                                onChange={(event) =>
                                  handleShiftTypeChanged(
                                    assignment.id,
                                    event.target.value as ScheduleRoomAssignment["shiftType"],
                                  )
                                }
                                aria-label={`Shift type for ${roomName}`}
                                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-sm text-slate-700"
                              >
                                <option value="full_shift">Full shift</option>
                                <option value="first_half">1st half</option>
                                <option value="second_half">2nd half</option>
                                <option value="short_shift">Short</option>
                              </select>
                            ) : null}
                          </div>
                          {providerSelectionShouldShow ? (
                            <div className="mt-3 border-t border-slate-100 pt-3">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-xs font-semibold uppercase text-slate-500">
                                  Provider
                                </p>
                                <span
                                  className={selectedStatusClassName}
                                >
                                  {selectedStatusLabel}
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
                                          selectedStatusIsValid
                                            ? "block text-xs text-emerald-700"
                                            : selectedStatusIsWarning
                                              ? "block text-xs text-amber-700"
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
                                    const optionIsSelectable =
                                      providerOptionIsSelectable(option);
                                    const optionButtonClassName =
                                      providerOptionButtonClassName(
                                        isSelected,
                                        optionIsSelectable,
                                      );
                                    const firstReason = option.reasons.at(0);
                                    const optionHasWarnings = hasWarningProviderReasons(
                                      option.reasons,
                                    );
                                    const optionStatusClassName =
                                      option.isEligible && !optionHasWarnings
                                        ? "block text-xs text-emerald-700"
                                        : option.isEligible
                                          ? "block text-xs text-amber-700"
                                          : "block text-xs text-red-700";
                                    const optionStatusLabel =
                                      option.isEligible && !optionHasWarnings
                                        ? "Eligible"
                                        : option.isEligible
                                          ? `Warning: ${
                                              firstReason?.message ??
                                              "Review recommended."
                                            }`
                                          : `Not eligible: ${
                                              firstReason?.message ??
                                              "Review required."
                                            }`;
                                    const availabilityLabel = optionAvailabilityLabel(option);
                                    const shiftCountLabel = optionShiftCountLabel(option);
                                    return (
                                      <button
                                        key={option.provider.id}
                                        type="button"
                                        disabled={!optionIsSelectable}
                                        onClick={() =>
                                          handleProviderSelected(assignment, option)
                                        }
                                        className={optionButtonClassName}
                                      >
                                        <span className="block text-sm font-semibold text-slate-950">
                                          {option.provider.display_name}
                                        </span>
                                        <span className="block text-xs text-slate-500">
                                          {availabilityLabel} - {shiftCountLabel}
                                        </span>
                                        <span
                                          className={optionStatusClassName}
                                        >
                                          {optionStatusLabel}
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
                                        className={selectedMessageClassName}
                                      >
                                        {message}
                                      </p>
                                    );
                                  })}
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                          </div>
                        </div>
                      );
                    })}
                    {dropIndicatorMatches(column.key, dayAssignments.length) ? (
                      <div className="h-1 rounded bg-teal-600" aria-hidden="true" />
                    ) : null}
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
          <aside className="rounded-md border border-slate-200 bg-white 2xl:sticky 2xl:top-4 2xl:self-start">
            <div className="border-b border-slate-200 px-4 py-3">
              <h3 className="text-sm font-semibold text-slate-950">
                Available rooms
              </h3>
            </div>
            <div className="max-h-[42rem] space-y-2 overflow-y-auto p-3 2xl:max-h-[calc(100vh-7rem)]">
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
