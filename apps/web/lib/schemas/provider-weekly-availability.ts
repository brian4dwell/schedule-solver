import { z } from "zod";

export const availabilityOptionSchema = z.enum([
  "full_shift",
  "first_half",
  "second_half",
  "short_shift",
  "none",
  "unset",
]);

export const weekdaySchema = z.enum([
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
]);

export const providerWeeklyAvailabilityDaySchema = z.object({
  weekday: weekdaySchema,
  options: z.array(availabilityOptionSchema).min(1),
});

function hasOneRowPerWeekday(value: { days: { weekday: Weekday }[] }) {
  const weekdays = value.days.map((day) => day.weekday);
  const uniqueWeekdays = new Set(weekdays);
  const uniqueCount = uniqueWeekdays.size;
  const hasEveryWeekday = uniqueCount === 7;
  return hasEveryWeekday;
}

export const providerWeeklyAvailabilitySchema = z
  .object({
    scheduleWeekId: z.string().uuid(),
    providerId: z.string().uuid(),
    isLocked: z.boolean(),
    days: z.array(providerWeeklyAvailabilityDaySchema).length(7),
  })
  .refine(
    hasOneRowPerWeekday,
    { message: "Each weekday must appear exactly once." },
  );

export const providerWeeklyAvailabilityReadApiSchema = z
  .object({
    schedule_week_id: z.string().uuid(),
    provider_id: z.string().uuid(),
    is_locked: z.boolean(),
    days: z.array(providerWeeklyAvailabilityDaySchema).length(7),
  })
  .transform((value) => {
    const availability = {
      scheduleWeekId: value.schedule_week_id,
      providerId: value.provider_id,
      isLocked: value.is_locked,
      days: value.days,
    };
    const parsedAvailability = providerWeeklyAvailabilitySchema.parse(availability);
    return parsedAvailability;
  });

export const providerWeeklyAvailabilityReplaceApiSchema = z
  .object({
    days: z.array(providerWeeklyAvailabilityDaySchema).length(7),
  })
  .refine(
    hasOneRowPerWeekday,
    { message: "Each weekday must appear exactly once." },
  );

export type ProviderWeeklyAvailability = z.infer<
  typeof providerWeeklyAvailabilitySchema
>;

export type AvailabilityOption = z.infer<typeof availabilityOptionSchema>;

export type Weekday = z.infer<typeof weekdaySchema>;
