import { z } from "zod";

import { usTimezoneSchema } from "@/lib/timezones";

export const centerColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Choose a six-digit hex color.").nullable();

export const centerColorUpdateSchema = z.object({
  color: centerColorSchema,
});

export const centerApiSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  color: centerColorSchema,
  address_line_1: z.string().nullable(),
  address_line_2: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  postal_code: z.string().nullable(),
  timezone: z.string().min(1),
  is_active: z.boolean(),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
});

export const centersApiSchema = z.array(centerApiSchema);

export const centerSchema = z.object({
  name: z.string().min(1),
  color: centerColorSchema,
  addressLine1: z.string().optional(),
  addressLine2: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postalCode: z.string().optional(),
  timezone: usTimezoneSchema,
});

export type CenterFormValues = z.infer<typeof centerSchema>;
export type CenterApi = z.infer<typeof centerApiSchema>;
