import { getWorld } from "@/lib/world/store";
import { ServiceError } from "./errors";
import type { SystemCadence } from "@/lib/types/api";

/**
 * The system's single "next update" cadence group. Under the monthly resolution
 * pulse the whole galaxy resolves together on `tick % MONTH_LENGTH === 0`, so the
 * group is uniformly 0; the client pairs it with the live tick via
 * `ticksUntilShard(pulseGroup, tick, MONTH_LENGTH)` to render the countdown.
 */
export function getSystemCadence(systemId: string): SystemCadence {
  const world = getWorld();
  const system = world.systems.find((s) => s.id === systemId);
  if (!system) throw new ServiceError("System not found.", 404);
  return { pulseGroup: 0 };
}
