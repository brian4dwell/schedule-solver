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

export const providerWeeklyAvailabilitySchema = z
  .object({
    scheduleWeekId: z.string().uuid(),
    providerId: z.string().uuid(),
    isLocked: z.boolean(),
    minShiftsRequested: z.number().int().min(0).max(14),
    maxShiftsRequested: z.number().int().min(0).max(14),
    days: z.array(providerWeeklyAvailabilityDaySchema).length(7),
  })
  .refine(
    (value) => {
      const minimum = value.minShiftsRequested;
      const maximum = value.maxShiftsRequested;
      const isValidRange = minimum <= maximum;
      return isValidRange;
    },
    { message: "Minimum shifts requested must be less than or equal to maximum shifts requested." },
  )
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
