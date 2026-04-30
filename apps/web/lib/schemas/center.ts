import { z } from "zod";

import { usTimezoneSchema } from "@/lib/timezones";

export const centerSchema = z.object({
  name: z.string().min(1),
  addressLine1: z.string().optional(),
  addressLine2: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postalCode: z.string().optional(),
  timezone: usTimezoneSchema,
});

export type CenterFormValues = z.infer<typeof centerSchema>;
