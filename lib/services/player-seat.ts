/**
 * The player-seat guard every mutation service (`claims.ts`, `construction-orders.ts`) opens with:
 * a world loaded, and a player seat on it. One shared shape and one shared check, so the two
 * services' identical guards cannot drift — `claims.ts` and `construction-orders.ts` both used to
 * hand-roll `Seat`/`requireSeat` character-for-character, and `construction-orders.ts`'s copy
 * dropped `player` from the returned shape, forcing every caller that needed it (`setAutomation`)
 * to re-check `!player` a second time even though `requireSeat` had already refused a missing one.
 */
import { getWorld, hasWorld } from "@/lib/world/store";
import type { World, WorldPlayer } from "@/lib/world/types";

export interface Seat {
  world: World;
  factionId: string;
  player: WorldPlayer;
}

export function requireSeat(): Seat | { error: string } {
  if (!hasWorld()) return { error: "No world loaded." };
  const world = getWorld();
  if (!world.player) return { error: "This world has no player seat." };
  return { world, factionId: world.player.controlledFactionId, player: world.player };
}
