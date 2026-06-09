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

function dayAvailableShiftCapacity(day: { options: AvailabilityOption[] }): number {
  const hasFullShift = day.options.includes("full_shift");
  const hasFirstHalfShift = day.options.includes("first_half");
  const hasSecondHalfShift = day.options.includes("second_half");
  const hasShortShift = day.options.includes("short_shift");
  const hasPartialShift = hasFirstHalfShift || hasSecondHalfShift || hasShortShift;

  if (hasFullShift) {
    return 1;
  }

  if (hasPartialShift) {
    return 0.5;
  }

  return 0;
}

function totalAvailableShiftCapacity(value: { days: { options: AvailabilityOption[] }[] }) {
  const dayCapacities: number[] = value.days.map(dayAvailableShiftCapacity);
  const totalCapacity = dayCapacities.reduce((sum, capacity) => sum + capacity, 0);
  return totalCapacity;
}

function roundToNearestHalf(value: number) {
  const scaledValue = value * 2;
  const roundedScaledValue = Math.round(scaledValue);
  const roundedValue = roundedScaledValue / 2;
  return roundedValue;
}

function minimumRequestFitsAvailability(value: {
  minShiftsRequested: number;
  maxShiftsRequested: number;
  days: { options: AvailabilityOption[] }[];
}) {
  const availableShiftCapacity = totalAvailableShiftCapacity(value);
  const minimumFitsCapacity = value.minShiftsRequested <= availableShiftCapacity;
  return minimumFitsCapacity;
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
  const requestsFitAvailability = minimumRequestFitsAvailability(availability);
  return requestsFitAvailability;
}

export const providerWeeklyAvailabilitySchema = z
  .object({
    scheduleWeekId: z.string().uuid(),
    providerId: z.string().uuid(),
    isLocked: z.boolean(),
    minShiftsRequested: z.number().min(0).max(14),
    maxShiftsRequested: z.number().min(0).max(14),
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
    minimumRequestFitsAvailability,
    { message: "Minimum shifts requested cannot exceed selected availability capacity." },
  )
  .refine(
    hasOneRowPerWeekday,
    { message: "Each weekday must appear exactly once." },
  )
  .transform((value) => {
    const minShiftsRequested = roundToNearestHalf(value.minShiftsRequested);
    const maxShiftsRequested = roundToNearestHalf(value.maxShiftsRequested);
    const roundedValue = {
      ...value,
      minShiftsRequested,
      maxShiftsRequested,
    };
    return roundedValue;
  });

export const providerWeeklyAvailabilityReadApiSchema = z
  .object({
    schedule_week_id: z.string().uuid(),
    provider_id: z.string().uuid(),
    is_locked: z.boolean(),
    min_shifts_requested: z.number().min(0).max(14),
    max_shifts_requested: z.number().min(0).max(14),
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
    min_shifts_requested: z.number().min(0).max(14),
    max_shifts_requested: z.number().min(0).max(14),
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
    { message: "Minimum shifts requested cannot exceed selected availability capacity." },
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
