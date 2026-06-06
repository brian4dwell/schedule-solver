import type {
  ProviderPortalAvailabilityRecord,
  ProviderPortalPreferenceOptionRecord,
  ProviderPortalProfile,
  ProviderPreferences,
} from "@/lib/api";
import type {
  AvailabilityOption,
  Weekday,
} from "@/lib/schemas/provider-weekly-availability";

export type ProviderPortalWorkspaceProps = {
  availabilityRecords: ProviderPortalAvailabilityRecord[];
  preferenceOptions: ProviderPortalPreferenceOptionRecord;
  preferences: ProviderPreferences;
  profile: ProviderPortalProfile;
};

export type CenterPreferenceDraft = {
  centerId: string;
  name: string;
  preferenceLevel: number;
};

export type ShiftTypePreferenceDraft = {
  shiftType: string;
  preferenceLevel: number;
};

export type ProviderPortalSection = "weekAvailability" | "calendarAvailability" | "preferences";

export type ProviderPortalNavigationItem = {
  id: ProviderPortalSection;
  label: string;
};

export type ShiftRequestField = "min" | "max";

export type ShiftRequestControlsProps = {
  maxShiftsRequested: number;
  minShiftsRequested: number;
  onChange: (field: ShiftRequestField, value: string) => void;
};

export type WeekAvailabilityViewProps = {
  availabilityMessage: string | null;
  isSavingAvailability: boolean;
  onDayChange: (weekday: Weekday, option: AvailabilityOption, isChecked: boolean) => void;
  onSave: () => Promise<boolean>;
  onShiftRequestChange: (field: ShiftRequestField, value: string) => void;
  record: ProviderPortalAvailabilityRecord | null;
};

export type CalendarAvailabilityViewProps = {
  availabilityMessage: string | null;
  isSavingAvailability: boolean;
  monthStartIso: string;
  onCalendarDayChange: (
    record: ProviderPortalAvailabilityRecord,
    weekday: Weekday,
    option: AvailabilityOption,
  ) => void;
  onMonthChange: (monthStartIso: string) => void;
  onRecordSave: (record: ProviderPortalAvailabilityRecord) => void;
  onRecordSelect: (weekId: string) => void;
  onRecordShiftRequestChange: (
    record: ProviderPortalAvailabilityRecord,
    field: ShiftRequestField,
    value: string,
  ) => void;
  onSave: () => Promise<boolean>;
  records: ProviderPortalAvailabilityRecord[];
};

export type PreferencesViewProps = {
  centerDrafts: CenterPreferenceDraft[];
  isSavingPreferences: boolean;
  onCenterDraftsChange: (drafts: CenterPreferenceDraft[]) => void;
  onSave: () => void;
  onShiftTypeDraftsChange: (drafts: ShiftTypePreferenceDraft[]) => void;
  preferenceMessage: string | null;
  shiftTypeDrafts: ShiftTypePreferenceDraft[];
};

export type ProviderPortalSidebarProps = {
  activeSection: ProviderPortalSection;
  completionText: string;
  onSectionChange: (section: ProviderPortalSection) => void;
  onWeekSelect: (weekId: string) => void;
  profile: ProviderPortalProfile;
  records: ProviderPortalAvailabilityRecord[];
  selectedWeekId: string;
};
