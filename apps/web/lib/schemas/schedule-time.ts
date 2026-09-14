import { z } from "zod";

export const scheduleDateSchema = z.iso.date();
export const wallClockSchema = z.string().regex(/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/);

export const clockRangeSchema = z.object({
  start_time: wallClockSchema,
  end_time: wallClockSchema,
}).refine((range) => range.end_time > range.start_time, {
  message: "Slot end time must be after start time on the same date.",
  path: ["end_time"],
});

export const scheduleTimeRangeSchema = clockRangeSchema.safeExtend({
  schedule_date: scheduleDateSchema,
});
