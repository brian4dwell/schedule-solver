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
  option: availabilityOptionSchema,
});

export const providerWeeklyAvailabilitySchema = z
  .object({
    scheduleWeekId: z.string().uuid(),
    providerId: z.string().uuid(),
    isLocked: z.boolean(),
    days: z.array(providerWeeklyAvailabilityDaySchema).length(7),
  })
  .refine(
    (value) => {
      const weekdays = value.days.map((day) => day.weekday);
      const uniqueWeekdays = new Set(weekdays);
      const uniqueCount = uniqueWeekdays.size;
      return uniqueCount === 7;
    },
    { message: "Each weekday must appear exactly once." },
  );

export const providerWeeklyAvailabilityApiSchema = providerWeeklyAvailabilitySchema;

export type ProviderWeeklyAvailability = z.infer<
  typeof providerWeeklyAvailabilitySchema
>;

export type AvailabilityOption = z.infer<typeof availabilityOptionSchema>;

export type Weekday = z.infer<typeof weekdaySchema>;
