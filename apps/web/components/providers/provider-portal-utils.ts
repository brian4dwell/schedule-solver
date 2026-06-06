import type {
  ProviderPortalAvailabilityRecord,
  ProviderPortalPreferenceOptionRecord,
  ProviderPreferences,
  ProviderPreferencesSavePayload,
} from "@/lib/api";
import type {
  AvailabilityOption,
  Weekday,
} from "@/lib/schemas/provider-weekly-availability";

import type {
  CenterPreferenceDraft,
  ProviderPortalNavigationItem,
  ProviderPortalSection,
  ShiftTypePreferenceDraft,
} from "./provider-portal-types";

export const providerPortalNavigationItems: ProviderPortalNavigationItem[] = [
  {
    id: "weekAvailability",
    label: "Availability by Week",
  },
  {
    id: "calendarAvailability",
    label: "Calendar",
  },
  {
    id: "preferences",
    label: "Preferences",
  },
];

export function providerPortalSectionFromViewValue(value: string | null): ProviderPortalSection {
  if (value === null) {
    return "weekAvailability";
  }

  if (value === "week") {
    return "weekAvailability";
  }

  if (value === "calendar") {
    return "calendarAvailability";
  }

  if (value === "preferences") {
    return "preferences";
  }

  throw new Error("Provider portal view value is invalid.");
}

export function providerPortalViewValueForSection(section: ProviderPortalSection) {
  if (section === "weekAvailability") {
    return "week";
  }

  if (section === "calendarAvailability") {
    return "calendar";
  }

  if (section === "preferences") {
    return "preferences";
  }

  throw new Error("Provider portal section is invalid.");
}

export const weekdayOrder: Weekday[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

export const calendarWeekdayLabels = [
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
];

export const calendarEditableOptions: AvailabilityOption[] = [
  "full_shift",
  "first_half",
  "second_half",
  "short_shift",
  "none",
];

export const availabilityOptions: AvailabilityOption[] = [
  "full_shift",
  "first_half",
  "second_half",
  "short_shift",
  "none",
  "unset",
];

export const shiftTypes = [
  "full_shift",
  "first_half",
  "second_half",
  "short_shift",
];

export function labelFromSnake(value: string) {
  const withSpaces = value.replaceAll("_", " ");
  const label = withSpaces.charAt(0).toUpperCase() + withSpaces.slice(1);
  return label;
}

export function weekdayIndex(weekday: Weekday) {
  const index = weekdayOrder.indexOf(weekday);

  if (index === -1) {
    throw new Error("Weekday must resolve to a day index.");
  }

  return index;
}

export function dateAtUtcMidnight(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  return date;
}

export function isoDateForDate(value: Date) {
  const isoDate = value.toISOString().slice(0, 10);
  return isoDate;
}

export function addDays(value: Date, dayCount: number) {
  const date = new Date(value);
  const nextDate = date.getUTCDate() + dayCount;
  date.setUTCDate(nextDate);
  return date;
}

export function addMonths(value: Date, monthCount: number) {
  const date = new Date(value);
  const nextMonth = date.getUTCMonth() + monthCount;
  date.setUTCMonth(nextMonth);
  return date;
}

export function monthStartForDate(value: Date) {
  const date = new Date(value);
  date.setUTCDate(1);
  return date;
}

export function monthStartIsoForDate(value: Date) {
  const monthStart = monthStartForDate(value);
  const monthStartIso = isoDateForDate(monthStart);
  return monthStartIso;
}

export function monthLabelForDate(value: Date) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  });
  const label = formatter.format(value);
  return label;
}

export function fullDateLabelForDate(value: Date) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  });
  const label = formatter.format(value);
  return label;
}

export function formatWeekdayDate(value: Date) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  });
  const formattedValue = formatter.format(value);
  const dateLabel = formattedValue.replace(" ", "-");
  return dateLabel;
}

export function dateForWeekday(weekStartDate: string, weekday: Weekday) {
  const weekStart = dateAtUtcMidnight(weekStartDate);
  const dayOffset = weekdayIndex(weekday);
  const date = addDays(weekStart, dayOffset);
  return date;
}

export function colorClassForWeekday(weekday: Weekday) {
  if (weekday === "monday") {
    return "border-rose-200 bg-rose-50";
  }

  if (weekday === "tuesday") {
    return "border-amber-200 bg-amber-50";
  }

  if (weekday === "wednesday") {
    return "border-lime-200 bg-lime-50";
  }

  if (weekday === "thursday") {
    return "border-emerald-200 bg-emerald-50";
  }

  if (weekday === "friday") {
    return "border-sky-200 bg-sky-50";
  }

  if (weekday === "saturday") {
    return "border-indigo-200 bg-indigo-50";
  }

  return "border-violet-200 bg-violet-50";
}

export function weekdayForDate(value: Date): Weekday {
  const weekdayIndex = value.getUTCDay();

  if (weekdayIndex === 0) {
    return "sunday";
  }

  if (weekdayIndex === 1) {
    return "monday";
  }

  if (weekdayIndex === 2) {
    return "tuesday";
  }

  if (weekdayIndex === 3) {
    return "wednesday";
  }

  if (weekdayIndex === 4) {
    return "thursday";
  }

  if (weekdayIndex === 5) {
    return "friday";
  }

  return "saturday";
}

export function calendarStartForMonth(monthStart: Date) {
  const monthStartWeekday = monthStart.getUTCDay();
  const calendarStart = addDays(monthStart, -monthStartWeekday);
  return calendarStart;
}

export function calendarDatesForMonth(monthStartIso: string) {
  const monthStart = dateAtUtcMidnight(monthStartIso);
  const calendarStart = calendarStartForMonth(monthStart);
  const allDates = Array.from({ length: 42 }, (_value, index) => {
    const date = addDays(calendarStart, index);
    return date;
  });
  const dates = allDates.filter((date) => {
    const weekdayIndex = date.getUTCDay();
    const isSunday = weekdayIndex === 0;
    const isSaturday = weekdayIndex === 6;
    const isWeekday = !isSunday && !isSaturday;
    return isWeekday;
  });
  return dates;
}

export function dateIsInRecord(dateIso: string, record: ProviderPortalAvailabilityRecord) {
  const isAfterStart = dateIso >= record.scheduleWeekStartDate;
  const isBeforeEnd = dateIso <= record.scheduleWeekEndDate;
  const isInRecord = isAfterStart && isBeforeEnd;
  return isInRecord;
}

export function recordForDate(dateIso: string, records: ProviderPortalAvailabilityRecord[]) {
  const record = records.find((candidate) => {
    const dateMatchesRecord = dateIsInRecord(dateIso, candidate);
    return dateMatchesRecord;
  });
  const matchedRecord = record ?? null;
  return matchedRecord;
}

export function monthOptionsForRecords(records: ProviderPortalAvailabilityRecord[]) {
  const monthValues = new Set<string>();

  records.forEach((record) => {
    const startDate = dateAtUtcMidnight(record.scheduleWeekStartDate);
    const endDate = dateAtUtcMidnight(record.scheduleWeekEndDate);
    let currentMonth = monthStartForDate(startDate);
    const endMonthIso = monthStartIsoForDate(endDate);

    while (isoDateForDate(currentMonth) <= endMonthIso) {
      const monthIso = isoDateForDate(currentMonth);
      monthValues.add(monthIso);
      currentMonth = addMonths(currentMonth, 1);
    }
  });

  const sortedMonthValues = Array.from(monthValues).sort();
  return sortedMonthValues;
}

export function optionIsExclusive(option: AvailabilityOption) {
  const optionIsUnset = option === "unset";
  const optionIsNone = option === "none";
  const isExclusive = optionIsUnset || optionIsNone;
  return isExclusive;
}

export function optionIsWorkAvailability(option: AvailabilityOption) {
  const isWorkAvailability = !optionIsExclusive(option);
  return isWorkAvailability;
}

export function dayHasWorkAvailability(day: { options: AvailabilityOption[] }) {
  const hasWorkAvailability = day.options.some(optionIsWorkAvailability);
  return hasWorkAvailability;
}

export function countWorkAvailableDays(days: { options: AvailabilityOption[] }[]) {
  const workAvailableDays = days.filter(dayHasWorkAvailability);
  const workAvailableDayCount = workAvailableDays.length;
  return workAvailableDayCount;
}

export function clampValue(value: number, minimum: number, maximum: number) {
  const atLeastMinimum = Math.max(value, minimum);
  const clampedValue = Math.min(atLeastMinimum, maximum);
  return clampedValue;
}

export function centerPreferenceDrafts(
  options: ProviderPortalPreferenceOptionRecord,
  preferences: ProviderPreferences,
) {
  const drafts = options.centerOptions.map((center) => {
    const preference = preferences.center_preferences.find((candidate) => {
      const matchesCenter = candidate.center_id === center.centerId;
      return matchesCenter;
    });
    const preferenceLevel = preference?.preference_level ?? 0;
    const draft = {
      centerId: center.centerId,
      name: center.name,
      preferenceLevel,
    };
    return draft;
  });
  return drafts;
}

export function shiftTypePreferenceDrafts(preferences: ProviderPreferences) {
  const drafts = shiftTypes.map((shiftType) => {
    const preference = preferences.shift_type_preferences.find((candidate) => {
      const matchesShiftType = candidate.shift_type === shiftType;
      return matchesShiftType;
    });
    const preferenceLevel = preference?.preference_level ?? 0;
    const draft = {
      shiftType,
      preferenceLevel,
    };
    return draft;
  });
  return drafts;
}

export function preferencePayload(
  centerDrafts: CenterPreferenceDraft[],
  shiftTypeDrafts: ShiftTypePreferenceDraft[],
): ProviderPreferencesSavePayload {
  const centerPreferences = centerDrafts.map((draft) => {
    const preference = {
      center_id: draft.centerId,
      preference_level: draft.preferenceLevel,
    };
    return preference;
  });
  const shiftTypePreferences = shiftTypeDrafts.map((draft) => {
    const preference = {
      shift_type: draft.shiftType,
      preference_level: draft.preferenceLevel,
    };
    return preference;
  });
  const payload = {
    center_preferences: centerPreferences,
    shift_type_preferences: shiftTypePreferences,
  };
  return payload;
}
