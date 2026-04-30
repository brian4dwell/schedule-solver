"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import type { Center, Room } from "@/lib/api";
import type {
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
  centerName: string;
  name: string;
  mdOnly: boolean;
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
  rooms: RoomRow[];
  scheduleId: string;
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

function scheduleNameFromId(scheduleId: string) {
  const name = scheduleId
    .split("-")
    .map((word) => {
      const firstLetter = word.charAt(0).toUpperCase();
      const remainingLetters = word.slice(1);
      const titleWord = `${firstLetter}${remainingLetters}`;
      return titleWord;
    })
    .join(" ");
  return name;
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

function createInitialVersion(scheduleId: string): ScheduleVersion {
  const createdAt = new Date().toISOString();
  const version = {
    id: `${scheduleId}-working`,
    name: `${scheduleNameFromId(scheduleId)} Working Version`,
    status: "working",
    createdAt,
    assignments: [],
  };
  const parsedVersion = scheduleVersionSchema.parse(version);
  return parsedVersion;
}

function createInitialPublishEvents(): SchedulePublishEvent[] {
  const publishedAt = new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString();
  const publishEvent = {
    id: "publish-1",
    versionId: "published-version-1",
    publishedAt,
    summary: "Published initial provider schedule",
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
        centerName: row.center.name,
        name: row.room.name,
        mdOnly: row.room.md_only,
        roomTypeNames: row.room.room_types.map((roomType) => {
          return roomType.name;
        }),
      };
      return room;
    });
  return availableRooms;
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
  roomId: string,
  dayKey: ScheduleDayKey,
  sortOrder: number,
): ScheduleRoomAssignment {
  const assignment = {
    id: createAssignmentId(),
    dayKey,
    roomId,
    sortOrder,
  };
  return assignment;
}

export function ScheduleWorkspace({ rooms, scheduleId }: ScheduleWorkspaceProps) {
  const availableRooms = useMemo(() => {
    return availableRoomsFromRows(rooms);
  }, [rooms]);
  const [workingVersion, setWorkingVersion] = useState<ScheduleVersion>(() => {
    return createInitialVersion(scheduleId);
  });
  const [publishEvents, setPublishEvents] = useState<SchedulePublishEvent[]>(() => {
    return createInitialPublishEvents();
  });
  const [showWeekends, setShowWeekends] = useState(false);
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

  function handlePublishSchedule() {
    const publishedAt = new Date().toISOString();
    const nextEvent = schedulePublishEventSchema.parse({
      id: createPublishEventId(),
      versionId: workingVersion.id,
      publishedAt,
      summary: "Published current working schedule",
    });
    setPublishEvents((currentEvents) => {
      const nextEvents = [...currentEvents, nextEvent];
      return nextEvents;
    });
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
      const sortOrder = nextSortOrder(workingVersion.assignments, dayKey);
      const assignment = createRoomAssignment(payload.roomId, dayKey, sortOrder);
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
      const assignment = createRoomAssignment(payload.roomId, dayKey, targetIndex);
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

  function roomForAssignment(assignment: ScheduleRoomAssignment) {
    const room = availableRooms.find((availableRoom) => {
      return availableRoom.id === assignment.roomId;
    });
    return room;
  }

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
              Working schedule with {assignedRoomCount} assigned rooms. Last publish:
              {" "}
              {lastPublishedLabel}.
            </p>
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
              onClick={handlePublishSchedule}
              className="inline-flex h-9 items-center justify-center rounded-md bg-teal-700 px-3 text-sm font-semibold text-white hover:bg-teal-800"
            >
              Publish changes
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
                      {room.name}
                    </p>
                    <p className="text-xs text-slate-500">{room.centerName}</p>
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
