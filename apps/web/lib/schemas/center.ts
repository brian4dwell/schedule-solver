import { z } from "zod";

export const centerSchema = z.object({
  name: z.string().min(1),
  addressLine1: z.string().optional(),
  addressLine2: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postalCode: z.string().optional(),
  timezone: z.string().min(1),
});

export type CenterFormValues = z.infer<typeof centerSchema>;
