import { pruneOldNotifications } from "@/lib/services/notifications";
import type { TickProcessor, TickProcessorResult } from "../types";

const MAX_AGE_TICKS = 500;

export const notificationPruneProcessor: TickProcessor = {
  name: "notification-prune",
  frequency: 50,

  async process(ctx): Promise<TickProcessorResult> {
    const pruned = await pruneOldNotifications(ctx.tx, MAX_AGE_TICKS, ctx.tick);
    if (pruned > 0) {
      console.log(`[notification-prune] Deleted ${pruned} old notification(s)`);
    }
    return {};
  },
};
