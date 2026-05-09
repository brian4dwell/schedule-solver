import { z } from "zod";

const monthlyAvailabilityOptionSchema = z.enum([
  "full_shift",
  "first_half",
  "second_half",
  "short_shift",
]);

export const monthlyAvailabilityProviderApiSchema = z.object({
  provider_id: z.string().uuid(),
  provider_display_name: z.string().min(1),
  schedule_period_id: z.string().uuid(),
  schedule_period_name: z.string().min(1),
  options: z.array(monthlyAvailabilityOptionSchema),
});

export const monthlyAvailabilityDayApiSchema = z.object({
  date: z.string().min(1),
  providers: z.array(monthlyAvailabilityProviderApiSchema),
});

export const monthlyAvailabilityReportApiSchema = z.object({
  year: z.number().int(),
  month: z.number().int().min(1).max(12),
  start_date: z.string().min(1),
  end_date: z.string().min(1),
  days: z.array(monthlyAvailabilityDayApiSchema),
});

export const monthlyAvailabilitySelectionSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
});

export type MonthlyAvailabilityOption = z.infer<
  typeof monthlyAvailabilityOptionSchema
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

export type MonthlyAvailabilitySelection = z.infer<
  typeof monthlyAvailabilitySelectionSchema
>;
