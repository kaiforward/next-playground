import { z } from "zod";

export const claimSystemSchema = z.object({
  systemId: z.string().trim().min(1, "System is required"),
});

export type ClaimSystemInput = z.infer<typeof claimSystemSchema>;
