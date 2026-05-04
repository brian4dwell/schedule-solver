import { z } from "zod";

import {
  persistedScheduleVersionApiSchema,
  schedulePeriodApiSchema,
} from "@/lib/schemas/schedule";

export const fairnessStatusSchema = z.enum([
  "Healthy",
  "Watch",
  "Action Required",
]);

export const fairnessConfigVersionApiSchema = z.object({
  id: z.string().uuid(),
  version_number: z.number().int().min(1),
  status: z.string().min(1),
  decay_factor: z.number(),
  debt_weight: z.number(),
  favor_weight: z.number(),
  standard_priority_multiplier: z.number(),
  elevated_priority_multiplier: z.number(),
  critical_priority_multiplier: z.number(),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
});

export const providerFairnessSnapshotApiSchema = z.object({
  id: z.string().uuid(),
  provider_id: z.string().uuid(),
  provider_display_name: z.string().min(1),
  schedule_period_id: z.string().uuid(),
  schedule_version_id: z.string().uuid(),
  starting_debt: z.number(),
  starting_favor_credit: z.number(),
  weekly_debt_delta: z.number(),
  weekly_favor_delta: z.number(),
  ending_debt: z.number(),
  ending_favor_credit: z.number(),
  fairness_pressure: z.number(),
  priority_tier: z.string().min(1),
  priority_multiplier: z.number(),
  assignment_count: z.number().int().min(0),
  negative_event_count: z.number().int().min(0),
  positive_event_count: z.number().int().min(0),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
});

export const providerFairnessEventApiSchema = z.object({
  id: z.string().uuid(),
  provider_id: z.string().uuid(),
  provider_display_name: z.string().min(1),
  schedule_period_id: z.string().uuid(),
  schedule_version_id: z.string().uuid(),
  assignment_id: z.string().uuid().nullable(),
  event_type: z.string().min(1),
  category: z.string().min(1),
  debt_delta: z.number(),
  favor_delta: z.number(),
  occurred_at: z.string().min(1),
  reason: z.string().min(1),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
});

export const fairnessMetricApiSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  value: z.string().min(1),
  status: fairnessStatusSchema,
  detail: z.string().min(1),
});

export const fairnessReportApiSchema = z.object({
  has_data: z.boolean(),
  schedule_period: schedulePeriodApiSchema.nullable(),
  schedule_version: persistedScheduleVersionApiSchema.nullable(),
  config: fairnessConfigVersionApiSchema.nullable(),
  metrics: z.array(fairnessMetricApiSchema),
  snapshots: z.array(providerFairnessSnapshotApiSchema),
  events: z.array(providerFairnessEventApiSchema),
});

export type FairnessStatus = z.infer<typeof fairnessStatusSchema>;

export type FairnessReportApi = z.infer<typeof fairnessReportApiSchema>;
