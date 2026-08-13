import { z } from "zod";

export const pinSchema = z.object({
  systemId: z.string().trim().min(1, "System id is required").max(64, "System id must be at most 64 characters"),
  pinned: z.boolean("pinned must be a boolean"),
});

export type PinInput = z.infer<typeof pinSchema>;
