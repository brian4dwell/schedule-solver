import { z } from "zod";

export const scheduleDayKeySchema = z.enum([
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
]);

export const scheduleVersionStatusSchema = z.enum([
  "working",
  "published",
  "superseded",
]);

export const scheduleRoomAssignmentSchema = z.object({
  id: z.string().min(1),
  dayKey: scheduleDayKeySchema,
  roomId: z.string().min(1),
  sortOrder: z.number().int().min(0),
});

export const scheduleVersionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  status: scheduleVersionStatusSchema,
  createdAt: z.string().min(1),
  assignments: z.array(scheduleRoomAssignmentSchema),
});

export const schedulePublishEventSchema = z.object({
  id: z.string().min(1),
  versionId: z.string().min(1),
  publishedAt: z.string().min(1),
  summary: z.string().min(1),
});

export const schedulePeriodSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  dateRange: z.string().min(1),
  currentVersionName: z.string().min(1),
  lastEditedAt: z.string().min(1),
  lastPublishedAt: z.string().min(1).nullable(),
  unpublishedChangeCount: z.number().int().min(0),
});

export type ScheduleDayKey = z.infer<typeof scheduleDayKeySchema>;

export type ScheduleVersionStatus = z.infer<typeof scheduleVersionStatusSchema>;

export type ScheduleRoomAssignment = z.infer<typeof scheduleRoomAssignmentSchema>;

export type ScheduleVersion = z.infer<typeof scheduleVersionSchema>;

export type SchedulePublishEvent = z.infer<typeof schedulePublishEventSchema>;

export type SchedulePeriodSummary = z.infer<typeof schedulePeriodSummarySchema>;
