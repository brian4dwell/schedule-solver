import { z } from "zod";

export const preferenceLevelSchema = z.number().int().min(-3).max(3);

export const preferenceWindowSchema = z.object({
  preference_level: preferenceLevelSchema,
  effective_start_date: z.string().nullable(),
  effective_end_date: z.string().nullable(),
});

export const providerCenterPreferenceApiSchema = preferenceWindowSchema.extend({
  id: z.string().uuid(),
  provider_id: z.string().uuid(),
  center_id: z.string().uuid(),
  is_active: z.boolean(),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
});

export const providerShiftTypePreferenceApiSchema = preferenceWindowSchema.extend({
  id: z.string().uuid(),
  provider_id: z.string().uuid(),
  shift_type: z.string().min(1),
  is_active: z.boolean(),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
});

export const managerProviderCenterPreferenceApiSchema = preferenceWindowSchema.extend({
  id: z.string().uuid(),
  provider_id: z.string().uuid(),
  center_id: z.string().uuid(),
  is_active: z.boolean(),
  manager_note: z.string().nullable(),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
});

export const providerPreferencesApiSchema = z.object({
  provider_id: z.string().uuid(),
  center_preferences: z.array(providerCenterPreferenceApiSchema),
  shift_type_preferences: z.array(providerShiftTypePreferenceApiSchema),
});

export const managerProviderPreferencesApiSchema = z.object({
  provider_id: z.string().uuid(),
  center_preferences: z.array(managerProviderCenterPreferenceApiSchema),
});

export const providerCenterPreferencePayloadSchema = preferenceWindowSchema.extend({
  center_id: z.string().uuid(),
});

export const providerShiftTypePreferencePayloadSchema = preferenceWindowSchema.extend({
  shift_type: z.string().min(1),
});

export const managerProviderCenterPreferencePayloadSchema = preferenceWindowSchema.extend({
  center_id: z.string().uuid(),
  manager_note: z.string().nullable(),
});

export const providerPreferencesPayloadSchema = z.object({
  center_preferences: z.array(providerCenterPreferencePayloadSchema),
  shift_type_preferences: z.array(providerShiftTypePreferencePayloadSchema),
});

export const managerProviderPreferencesPayloadSchema = z.object({
  center_preferences: z.array(managerProviderCenterPreferencePayloadSchema),
});

export type ProviderPreferencesApi = z.infer<typeof providerPreferencesApiSchema>;

export type ManagerProviderPreferencesApi = z.infer<typeof managerProviderPreferencesApiSchema>;

export type ProviderPreferencesPayload = z.infer<typeof providerPreferencesPayloadSchema>;

export type ManagerProviderPreferencesPayload = z.infer<typeof managerProviderPreferencesPayloadSchema>;
