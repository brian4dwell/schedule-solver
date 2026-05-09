import { z } from "zod";

const monthlyAvailabilityOptionSchema = z.enum([
  "full_shift",
  "first_half",
  "second_half",
  "short_shift",
]);

export const monthlyScheduleAssignmentApiSchema = z.object({
  assignment_id: z.string().uuid(),
  schedule_period_id: z.string().uuid(),
  schedule_period_name: z.string().min(1),
  schedule_version_id: z.string().uuid(),
  schedule_version_number: z.number().int().min(1),
  schedule_version_status: z.string().min(1),
  center_id: z.string().uuid(),
  center_name: z.string().min(1),
  room_id: z.string().uuid().nullable(),
  room_name: z.string().nullable(),
  shift_type: monthlyAvailabilityOptionSchema,
  start_time: z.string().min(1),
  end_time: z.string().min(1),
});

export const monthlyAvailabilityProviderApiSchema = z.object({
  provider_id: z.string().uuid(),
  provider_display_name: z.string().min(1),
  schedule_period_id: z.string().uuid(),
  schedule_period_name: z.string().min(1),
  options: z.array(monthlyAvailabilityOptionSchema),
  scheduled_assignments: z.array(monthlyScheduleAssignmentApiSchema),
});

export const monthlyAvailabilityDayApiSchema = z.object({
  date: z.string().min(1),
  providers: z.array(monthlyAvailabilityProviderApiSchema),
});

export const monthlyScheduleCandidateApiSchema = z.object({
  schedule_period_id: z.string().uuid(),
  schedule_period_name: z.string().min(1),
  start_date: z.string().min(1),
  end_date: z.string().min(1),
  latest_schedule_version_id: z.string().uuid(),
  latest_schedule_version_number: z.number().int().min(1),
  latest_schedule_version_status: z.string().min(1),
  latest_schedule_version_updated_at: z.string().min(1),
});

export const monthlyScheduleCandidateGroupApiSchema = z.object({
  group_key: z.string().min(1),
  start_date: z.string().min(1),
  end_date: z.string().min(1),
  selected_schedule_period_id: z.string().uuid(),
  candidates: z.array(monthlyScheduleCandidateApiSchema),
});

export const monthlyAvailabilityReportApiSchema = z.object({
  year: z.number().int(),
  month: z.number().int().min(1).max(12),
  start_date: z.string().min(1),
  end_date: z.string().min(1),
  schedule_candidate_groups: z.array(monthlyScheduleCandidateGroupApiSchema),
  days: z.array(monthlyAvailabilityDayApiSchema),
});

export const monthlyAvailabilitySelectionSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
});

export type MonthlyAvailabilityOption = z.infer<
  typeof monthlyAvailabilityOptionSchema
>;

export type MonthlyScheduleAssignmentApi = z.infer<
  typeof monthlyScheduleAssignmentApiSchema
>;

export type MonthlyAvailabilityProviderApi = z.infer<
  typeof monthlyAvailabilityProviderApiSchema
>;

export type MonthlyAvailabilityDayApi = z.infer<
  typeof monthlyAvailabilityDayApiSchema
>;

export type MonthlyAvailabilityReportApi = z.infer<
  typeof monthlyAvailabilityReportApiSchema
>;

export type MonthlyScheduleCandidateApi = z.infer<
  typeof monthlyScheduleCandidateApiSchema
>;

export type MonthlyScheduleCandidateGroupApi = z.infer<
  typeof monthlyScheduleCandidateGroupApiSchema
>;

export type MonthlyAvailabilitySelection = z.infer<
  typeof monthlyAvailabilitySelectionSchema
>;
