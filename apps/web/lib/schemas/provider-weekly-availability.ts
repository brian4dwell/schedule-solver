import { z } from "zod";

export const availabilityOptionSchema = z.enum([
  "full_shift",
  "first_half",
  "second_half",
  "short_shift",
  "none",
  "unset",
]);

const workAvailabilityOptions: AvailabilityOption[] = [
  "full_shift",
  "first_half",
  "second_half",
  "short_shift",
];

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

function dayHasWorkAvailability(day: { options: AvailabilityOption[] }) {
  const hasWorkOption = day.options.some((option) => workAvailabilityOptions.includes(option));
  return hasWorkOption;
}

function countWorkAvailableDays(value: { days: { options: AvailabilityOption[] }[] }) {
  const workAvailableDays = value.days.filter(dayHasWorkAvailability);
  const workAvailableDayCount = workAvailableDays.length;
  return workAvailableDayCount;
}

function shiftRequestsFitAvailability(value: {
  minShiftsRequested: number;
  maxShiftsRequested: number;
  days: { options: AvailabilityOption[] }[];
}) {
  const workAvailableDayCount = countWorkAvailableDays(value);
  const minimumFitsAvailableDays = value.minShiftsRequested <= workAvailableDayCount;
  const maximumFitsAvailableDays = value.maxShiftsRequested <= workAvailableDayCount;
  const requestsFitAvailability = minimumFitsAvailableDays && maximumFitsAvailableDays;
  return requestsFitAvailability;
}

function apiShiftRequestsFitAvailability(value: {
  min_shifts_requested: number;
  max_shifts_requested: number;
  days: { options: AvailabilityOption[] }[];
}) {
  const availability = {
    minShiftsRequested: value.min_shifts_requested,
    maxShiftsRequested: value.max_shifts_requested,
    days: value.days,
  };
  const requestsFitAvailability = shiftRequestsFitAvailability(availability);
  return requestsFitAvailability;
}

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
      const rangeIsValid = minimum <= maximum;
      return rangeIsValid;
    },
    { message: "Minimum shifts requested must be less than or equal to maximum shifts requested." },
  )
  .refine(
    shiftRequestsFitAvailability,
    { message: "Shift requests cannot exceed days with work availability selected." },
  )
  .refine(
    hasOneRowPerWeekday,
    { message: "Each weekday must appear exactly once." },
  );

export const providerWeeklyAvailabilityReadApiSchema = z
  .object({
    schedule_week_id: z.string().uuid(),
    provider_id: z.string().uuid(),
    is_locked: z.boolean(),
    min_shifts_requested: z.number().int().min(0).max(14),
    max_shifts_requested: z.number().int().min(0).max(14),
    days: z.array(providerWeeklyAvailabilityDaySchema).length(7),
  })
  .transform((value) => {
    const availability = {
      scheduleWeekId: value.schedule_week_id,
      providerId: value.provider_id,
      isLocked: value.is_locked,
      minShiftsRequested: value.min_shifts_requested,
      maxShiftsRequested: value.max_shifts_requested,
      days: value.days,
    };
    const parsedAvailability = providerWeeklyAvailabilitySchema.parse(availability);
    return parsedAvailability;
  });

export const providerWeeklyAvailabilityReplaceApiSchema = z
  .object({
    min_shifts_requested: z.number().int().min(0).max(14),
    max_shifts_requested: z.number().int().min(0).max(14),
    days: z.array(providerWeeklyAvailabilityDaySchema).length(7),
  })
  .refine(
    (value) => {
      const minimum = value.min_shifts_requested;
      const maximum = value.max_shifts_requested;
      const rangeIsValid = minimum <= maximum;
      return rangeIsValid;
    },
    { message: "Minimum shifts requested must be less than or equal to maximum shifts requested." },
  )
  .refine(
    apiShiftRequestsFitAvailability,
    { message: "Shift requests cannot exceed days with work availability selected." },
  )
  .refine(
    hasOneRowPerWeekday,
    { message: "Each weekday must appear exactly once." },
  );

export type ProviderWeeklyAvailability = z.infer<
  typeof providerWeeklyAvailabilitySchema
>;

export type AvailabilityOption = z.infer<typeof availabilityOptionSchema>;

export type Weekday = z.infer<typeof weekdaySchema>;
