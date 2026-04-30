import { z } from "zod";

export const providerTypeSchema = z.enum([
  "crna",
  "doctor",
  "staff",
  "contractor",
  "other",
]);

export const employmentTypeSchema = z.enum([
  "employee",
  "contractor",
  "locum",
  "other",
]);

export const providerSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  displayName: z.string().min(1),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  providerType: providerTypeSchema,
  employmentType: employmentTypeSchema,
  notes: z.string().optional(),
  credentialedCenterIds: z.array(z.string().uuid()),
});

export type ProviderFormValues = z.infer<typeof providerSchema>;

export const providerApiSchema = z.object({
  id: z.string().uuid(),
  first_name: z.string(),
  last_name: z.string(),
  display_name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  provider_type: providerTypeSchema,
  employment_type: employmentTypeSchema,
  notes: z.string().nullable(),
  credentialed_center_ids: z.array(z.string().uuid()),
  is_active: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const providersApiSchema = z.array(providerApiSchema);

export type ProviderApiValues = z.infer<typeof providerApiSchema>;
