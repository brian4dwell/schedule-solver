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
  "draft",
  "published",
  "superseded",
  "working",
]);

export const providerIneligibilityReasonSchema = z.object({
  code: z.string().min(1),
  category: z.enum([
    "missing_credential",
    "credential_inactive",
    "missing_skill",
    "md_requirement_not_met",
    "availability_conflict",
    "other_hard_constraint",
  ]),
  message: z.string().min(1),
});

export const providerPickerEligibilitySchema = z.object({
  providerId: z.string().uuid(),
  isEligible: z.boolean(),
  reasons: z.array(providerIneligibilityReasonSchema),
});

export const scheduleRoomAssignmentSchema = z.object({
  id: z.string().min(1),
  dayKey: scheduleDayKeySchema,
  centerId: z.string().uuid(),
  roomId: z.string().uuid(),
  providerId: z.string().uuid().nullable(),
  startTime: z.string().min(1),
  endTime: z.string().min(1),
  sortOrder: z.number().int().min(0),
  validationStatus: z.enum(["unknown", "valid", "warning", "invalid"]),
  validationMessages: z.array(z.string()),
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

export type ProviderIneligibilityReason = z.infer<
  typeof providerIneligibilityReasonSchema
>;

export type ProviderPickerEligibility = z.infer<
  typeof providerPickerEligibilitySchema
>;

export type ScheduleRoomAssignment = z.infer<typeof scheduleRoomAssignmentSchema>;

export type ScheduleVersion = z.infer<typeof scheduleVersionSchema>;

export type SchedulePublishEvent = z.infer<typeof schedulePublishEventSchema>;

export type SchedulePeriodSummary = z.infer<typeof schedulePeriodSummarySchema>;
