import { z } from "zod";

export const usTimezoneOptions = [
  {
    value: "America/New_York",
    label: "Eastern Time",
  },
  {
    value: "America/Chicago",
    label: "Central Time",
  },
  {
    value: "America/Denver",
    label: "Mountain Time",
  },
  {
    value: "America/Phoenix",
    label: "Arizona Time",
  },
  {
    value: "America/Los_Angeles",
    label: "Pacific Time",
  },
  {
    value: "America/Anchorage",
    label: "Alaska Time",
  },
  {
    value: "Pacific/Honolulu",
    label: "Hawaii Time",
  },
] as const;

export const usTimezoneValues = usTimezoneOptions.map((timezoneOption) => {
  const timezoneValue = timezoneOption.value;
  return timezoneValue;
});

export const usTimezoneSchema = z.enum(usTimezoneValues);

export type UsTimezone = z.infer<typeof usTimezoneSchema>;

export function parseUsTimezone(timezone: string): UsTimezone {
  const parsedTimezone = usTimezoneSchema.parse(timezone);
  return parsedTimezone;
}

export function formatTimezone(timezone: string): string {
  const parsedTimezone = parseUsTimezone(timezone);

  if (parsedTimezone === "America/New_York") {
    return "Eastern Time";
  }

  if (parsedTimezone === "America/Chicago") {
    return "Central Time";
  }

  if (parsedTimezone === "America/Denver") {
    return "Mountain Time";
  }

  if (parsedTimezone === "America/Phoenix") {
    return "Arizona Time";
  }

  if (parsedTimezone === "America/Los_Angeles") {
    return "Pacific Time";
  }

  if (parsedTimezone === "America/Anchorage") {
    return "Alaska Time";
  }

  return "Hawaii Time";
}
