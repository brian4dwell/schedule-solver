import { z } from "zod";

import {
  providerWeeklyAvailabilityReadApiSchema,
  providerWeeklyAvailabilitySchema,
} from "@/lib/schemas/provider-weekly-availability";

export const providerAccountStateSchema = z.enum([
  "invited",
  "accepted",
  "linked",
]);

export const providerPortalProfileApiSchema = z.object({
  provider_id: z.string().uuid(),
  display_name: z.string().min(1),
  email: z.string().email().nullable(),
}).strict();

export const providerInviteApiSchema = z.object({
  id: z.string().uuid(),
  provider_id: z.string().uuid(),
  email: z.string().email(),
  invite_token: z.string().min(1),
  status: z.string().min(1),
  accepted_by_clerk_user_id: z.string().nullable(),
  accepted_at: z.string().nullable(),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
}).strict();

export const providerInviteEmailSendApiSchema = z.object({
  invite: providerInviteApiSchema,
  recipient_email: z.string().email(),
  gmail_message_id: z.string().min(1),
  sent_at: z.string().min(1),
}).strict();

export const providerInviteAcceptanceApiSchema = z.object({
  provider: providerPortalProfileApiSchema,
}).strict();

export const providerWeeklyAvailabilityCompletionApiSchema = z.object({
  schedule_week_id: z.string().uuid(),
  schedule_week_name: z.string().min(1),
  schedule_week_start_date: z.string().min(1),
  schedule_week_end_date: z.string().min(1),
  is_complete: z.boolean(),
  unset_weekdays: z.array(z.string().min(1)),
}).strict();

export const providerPortalWeekAvailabilityApiSchema = z
  .object({
    schedule_week_id: z.string().uuid(),
    schedule_week_name: z.string().min(1),
    schedule_week_start_date: z.string().min(1),
    schedule_week_end_date: z.string().min(1),
    availability: z.unknown(),
    completion: providerWeeklyAvailabilityCompletionApiSchema,
  })
  .strict()
  .transform((value) => {
    const availability = providerWeeklyAvailabilityReadApiSchema.parse(value.availability);
    const weekAvailability = {
      scheduleWeekId: value.schedule_week_id,
      scheduleWeekName: value.schedule_week_name,
      scheduleWeekStartDate: value.schedule_week_start_date,
      scheduleWeekEndDate: value.schedule_week_end_date,
      availability,
      completion: {
        scheduleWeekId: value.completion.schedule_week_id,
        scheduleWeekName: value.completion.schedule_week_name,
        scheduleWeekStartDate: value.completion.schedule_week_start_date,
        scheduleWeekEndDate: value.completion.schedule_week_end_date,
        isComplete: value.completion.is_complete,
        unsetWeekdays: value.completion.unset_weekdays,
      },
    };
    return weekAvailability;
  });

export const providerPortalCenterOptionApiSchema = z.object({
  center_id: z.string().uuid(),
  name: z.string().min(1),
}).strict();

export const providerPortalPreferenceOptionsApiSchema = z
  .object({
    center_options: z.array(providerPortalCenterOptionApiSchema),
  })
  .strict()
  .transform((value) => {
    const options = {
      centerOptions: value.center_options.map((center) => {
        const option = {
          centerId: center.center_id,
          name: center.name,
        };
        return option;
      }),
    };
    return options;
  });

export const adminProviderStatusApiSchema = z
  .object({
    provider_id: z.string().uuid(),
    provider_name: z.string().min(1),
    provider_email: z.string().email().nullable(),
    account_state: providerAccountStateSchema.nullable(),
    last_availability_update_at: z.string().nullable(),
    open_week_count: z.number().int().min(0),
    incomplete_open_required_week_count: z.number().int().min(0),
    open_week_availability_complete: z.boolean(),
  })
  .strict()
  .transform((value) => {
    const status = {
      providerId: value.provider_id,
      providerName: value.provider_name,
      providerEmail: value.provider_email,
      accountState: value.account_state,
      lastAvailabilityUpdateAt: value.last_availability_update_at,
      openWeekCount: value.open_week_count,
      incompleteOpenRequiredWeekCount: value.incomplete_open_required_week_count,
      openWeekAvailabilityComplete: value.open_week_availability_complete,
    };
    return status;
  });

export const providerPortalAvailabilityPayloadApiSchema = providerWeeklyAvailabilitySchema.transform((value) => {
  const payload = {
    min_shifts_requested: value.minShiftsRequested,
    max_shifts_requested: value.maxShiftsRequested,
    days: value.days,
  };
  return payload;
});

export type ProviderPortalProfileApi = z.infer<typeof providerPortalProfileApiSchema>;

export type ProviderInviteApi = z.infer<typeof providerInviteApiSchema>;

export type ProviderInviteEmailSendApi = z.infer<
  typeof providerInviteEmailSendApiSchema
>;

export type ProviderPortalWeekAvailability = z.infer<
  typeof providerPortalWeekAvailabilityApiSchema
>;

export type ProviderPortalPreferenceOptions = z.infer<
  typeof providerPortalPreferenceOptionsApiSchema
>;

export type AdminProviderStatus = z.infer<typeof adminProviderStatusApiSchema>;
