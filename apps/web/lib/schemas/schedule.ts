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
  "archived",
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

export const schedulePeriodApiSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  start_date: z.string().min(1),
  end_date: z.string().min(1),
  status: z.string().min(1),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
});

export const schedulePeriodFormSchema = z.object({
  name: z.string().min(1),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
});

export const scheduleAssignmentApiSchema = z.object({
  id: z.string().uuid(),
  schedule_version_id: z.string().uuid(),
  schedule_period_id: z.string().uuid(),
  provider_id: z.string().uuid().nullable(),
  center_id: z.string().uuid(),
  room_id: z.string().uuid().nullable(),
  shift_requirement_id: z.string().uuid().nullable(),
  required_provider_type: z.string().nullable(),
  start_time: z.string().min(1),
  end_time: z.string().min(1),
  assignment_status: z.string().min(1),
  source: z.string().min(1),
  notes: z.string().nullable(),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
});

export const constraintViolationApiSchema = z.object({
  id: z.string().uuid(),
  schedule_version_id: z.string().uuid(),
  assignment_id: z.string().uuid().nullable(),
  severity: z.string().min(1),
  constraint_type: z.string().min(1),
  message: z.string().min(1),
  metadata_json: z.record(z.string(), z.unknown()).nullable(),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
});

export const persistedScheduleVersionApiSchema = z.object({
  id: z.string().uuid(),
  schedule_period_id: z.string().uuid(),
  schedule_job_id: z.string().uuid().nullable(),
  version_number: z.number().int().min(1),
  status: z.string().min(1),
  source: z.string().min(1),
  parent_schedule_version_id: z.string().uuid().nullable(),
  published_at: z.string().min(1).nullable(),
  published_by_user_id: z.string().uuid().nullable(),
  created_by_user_id: z.string().uuid().nullable(),
  solver_score: z.number().nullable(),
  notes: z.string().nullable(),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
});

export const scheduleVersionDetailApiSchema = z.object({
  version: persistedScheduleVersionApiSchema,
  assignments: z.array(scheduleAssignmentApiSchema),
  violations: z.array(constraintViolationApiSchema),
});

export const scheduleDraftSaveResponseApiSchema = scheduleVersionDetailApiSchema;

export const providerEligibilityViolationApiSchema = z.object({
  severity: z.string().min(1),
  constraint_type: z.string().min(1),
  category: z.string().min(1),
  message: z.string().min(1),
});

export const schedulePublishResponseApiSchema = z.object({
  version: persistedScheduleVersionApiSchema,
  violations: z.array(providerEligibilityViolationApiSchema),
});

export const schedulePublishEventSchema = z.object({
  id: z.string().min(1),
  versionId: z.string().min(1),
  publishedAt: z.string().min(1),
  summary: z.string().min(1),
});

export const schedulePeriodSummarySchema = z.object({
  id: z.string().uuid(),
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

export type SchedulePeriodApi = z.infer<typeof schedulePeriodApiSchema>;

export type SchedulePeriodFormValues = z.infer<typeof schedulePeriodFormSchema>;

export type ScheduleAssignmentApi = z.infer<typeof scheduleAssignmentApiSchema>;

export type ConstraintViolationApi = z.infer<typeof constraintViolationApiSchema>;

export type PersistedScheduleVersionApi = z.infer<
  typeof persistedScheduleVersionApiSchema
>;

export type ScheduleVersionDetailApi = z.infer<
  typeof scheduleVersionDetailApiSchema
>;

export type SchedulePublishResponseApi = z.infer<
  typeof schedulePublishResponseApiSchema
>;
