import { z } from "zod";

export const preferenceLevelSchema = z.number().int().min(-3).max(3);

export const preferenceLevelFieldsSchema = z.object({
  preference_level: preferenceLevelSchema,
}).strict();

export const providerCenterPreferenceApiSchema = preferenceLevelFieldsSchema.extend({
  id: z.string().uuid(),
  provider_id: z.string().uuid(),
  center_id: z.string().uuid(),
  is_active: z.boolean(),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
});

export const providerShiftTypePreferenceApiSchema = preferenceLevelFieldsSchema.extend({
  id: z.string().uuid(),
  provider_id: z.string().uuid(),
  shift_type: z.string().min(1),
  is_active: z.boolean(),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
});

export const managerProviderCenterPreferenceApiSchema = preferenceLevelFieldsSchema.extend({
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
}).strict();

export const managerProviderPreferencesApiSchema = z.object({
  provider_id: z.string().uuid(),
  center_preferences: z.array(managerProviderCenterPreferenceApiSchema),
}).strict();

export const providerCenterPreferencePayloadSchema = preferenceLevelFieldsSchema.extend({
  center_id: z.string().uuid(),
});

export const providerShiftTypePreferencePayloadSchema = preferenceLevelFieldsSchema.extend({
  shift_type: z.string().min(1),
});

export const managerProviderCenterPreferencePayloadSchema = preferenceLevelFieldsSchema.extend({
  center_id: z.string().uuid(),
  manager_note: z.string().nullable(),
});

export const providerPreferencesPayloadSchema = z.object({
  center_preferences: z.array(providerCenterPreferencePayloadSchema),
  shift_type_preferences: z.array(providerShiftTypePreferencePayloadSchema),
}).strict();

export const managerProviderPreferencesPayloadSchema = z.object({
  center_preferences: z.array(managerProviderCenterPreferencePayloadSchema),
}).strict();

export type ProviderPreferencesApi = z.infer<typeof providerPreferencesApiSchema>;

export type ManagerProviderPreferencesApi = z.infer<typeof managerProviderPreferencesApiSchema>;

export type ProviderPreferencesPayload = z.infer<typeof providerPreferencesPayloadSchema>;

export type ManagerProviderPreferencesPayload = z.infer<typeof managerProviderPreferencesPayloadSchema>;
