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
});

export type ProviderFormValues = z.infer<typeof providerSchema>;
