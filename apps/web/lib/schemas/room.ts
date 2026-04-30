import { z } from "zod";

export const roomSchema = z.object({
  centerId: z.string().min(1),
  name: z.string().min(1),
  displayOrder: z.coerce.number().int().min(0),
});

export type RoomFormValues = z.infer<typeof roomSchema>;
