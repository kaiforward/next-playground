import { z } from "zod";

export const pinSchema = z.object({
  systemId: z.string().trim().min(1, "System id is required"),
  pinned: z.boolean("pinned must be a boolean"),
});

export type PinInput = z.infer<typeof pinSchema>;
