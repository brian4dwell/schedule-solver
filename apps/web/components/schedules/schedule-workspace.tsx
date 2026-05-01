"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import {
  publishScheduleVersion,
  saveDraftScheduleVersion,
  type Center,
  type Provider,
  type Room,
  type ScheduleAssignmentSavePayload,
  type SchedulePeriod,
  type ScheduleVersionDetail,
} from "@/lib/api";
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

function providerEligibilityForRoom(
  provider: Provider,
  room: AvailableRoom,
): ProviderPickerOption {
  const reasons: ProviderIneligibilityReason[] = [];

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

  const isEligible = reasons.length === 0;
  const option = {
    provider,
    isEligible,
    reasons,
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

function providerOptionsForRoom(
  providers: Provider[],
  room: AvailableRoom,
): ProviderPickerOption[] {
  const options = providers.map((provider) => {
    return providerEligibilityForRoom(provider, room);
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
  const [isSaving, setIsSaving] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [showWeekends, setShowWeekends] = useState(false);
  const [openProviderAssignmentId, setOpenProviderAssignmentId] = useState<
    string | null
  >(null);
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

      const options = providerOptionsForRoom(providers, room);
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

      const options = providerOptionsForRoom(providers, room);
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

  function handleProviderSelected(
    assignment: ScheduleRoomAssignment,
    option: ProviderPickerOption,
  ) {
    const validationStatus = validationStatusForSelection(option);
    const validationMessages = validationMessagesForSelection(option);
    const assignments = workingVersion.assignments.map((currentAssignment) => {
      if (currentAssignment.id !== assignment.id) {
        return currentAssignment;
      }

      const nextAssignment = {
        ...currentAssignment,
        providerId: option.provider.id,
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

  const invalidAssignmentCount = workingVersion.assignments.filter((assignment) => {
    const room = roomForAssignment(assignment);

    if (room === undefined) {
      return true;
    }

    const options = providerOptionsForRoom(providers, room);
    const option = selectedProviderOption(options, assignment.providerId);
    const validationStatus = validationStatusForSelection(option);
    const isInvalid = validationStatus !== "valid";
    return isInvalid;
  }).length;
  const hasSavedVersion = savedVersionDetail !== null;
  const canPublish =
    invalidAssignmentCount === 0 && assignedRoomCount > 0 && hasSavedVersion;

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
              {invalidAssignmentCount} publish blockers. Last publish:
              {" "}
              {lastPublishedLabel}.
            </p>
            {actionMessage !== null ? (
              <p className="mt-1 text-sm font-medium text-teal-700">
                {actionMessage}
              </p>
            ) : null}
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
                        room === undefined ? [] : providerOptionsForRoom(providers, room);
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
                          className="rounded-md border border-slate-200 bg-white p-3 shadow-sm"
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
