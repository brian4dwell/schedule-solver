import { z } from "zod";

export const roomSchema = z.object({
  centerId: z.string().min(1),
  name: z.string().min(1),
  displayOrder: z.coerce.number().int().min(0),
  mdOnly: z.boolean(),
  roomTypeIds: z.array(z.string().min(1)),
});

export type RoomFormValues = z.infer<typeof roomSchema>;

export const roomTypeSchema = z.object({
  name: z.string().min(1),
  displayOrder: z.coerce.number().int().min(0),
});

export type RoomTypeFormValues = z.infer<typeof roomTypeSchema>;
