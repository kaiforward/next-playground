/**
 * Player claim verb — the free, rate-limited land grab a player uses to push a border forward
 * (docs/planned/logistics-lanes.md §1). Unlike `orderBuild`/`orderColony`, this is not funded
 * through the construction pool: it costs nothing but time, gated by `PLAYER_CLAIM_COOLDOWN`.
 */
import { setWorld } from "@/lib/world/store";
import { requireSeat } from "@/lib/services/player-seat";
import { LANES } from "@/lib/constants/lanes";
import { CYCLE_LENGTH } from "@/lib/constants/tick-cadence";

export type ClaimSystemResult =
  | { ok: true; data: { systemId: string; nextClaimTick: number } }
  | { ok: false; error: string };

/**
 * Claim `systemId` for the player's faction: free, but refused unless the system is unclaimed,
 * adjacent (one lane) to a system the player already controls, and the player's last claim was at
 * least `PLAYER_CLAIM_COOLDOWN` cycles ago. Success flips the system to `controlled` and starts the
 * cooldown over — the same mechanic every faction's own expansion engine resolves through
 * (`applyClaims`, `lib/world/tick.ts`), reused here at the row-transform level only.
 */
export function claimSystem(input: { systemId: string }): ClaimSystemResult {
  const seat = requireSeat();
  if ("error" in seat) return { ok: false, error: seat.error };
  const { player } = seat;

  const system = seat.world.systems.find((s) => s.id === input.systemId);
  if (!system) return { ok: false, error: `System ${input.systemId} not found.` };
  if (system.factionId !== null) {
    return { ok: false, error: `${system.name} is already claimed.` };
  }

  const adjacent = seat.world.connections.some((c) => {
    let otherId: string | null = null;
    if (c.fromId === input.systemId) otherId = c.toId;
    else if (c.toId === input.systemId) otherId = c.fromId;
    if (otherId === null) return false;
    const other = seat.world.systems.find((s) => s.id === otherId);
    return other?.factionId === seat.factionId;
  });
  if (!adjacent) {
    return { ok: false, error: `${system.name} is not adjacent to your territory.` };
  }

  const currentTick = seat.world.meta.currentTick;
  const cooldownTicks = LANES.PLAYER_CLAIM_COOLDOWN * CYCLE_LENGTH;
  const lastClaimTick = player.lastClaimTick;
  if (lastClaimTick !== undefined) {
    const remaining = cooldownTicks - (currentTick - lastClaimTick);
    if (remaining > 0) {
      return { ok: false, error: `Claim cooldown: ${remaining} tick(s) remaining.` };
    }
  }

  const systems = seat.world.systems.map((s) =>
    s.id === input.systemId ? { ...s, factionId: seat.factionId, control: "controlled" as const } : s,
  );
  setWorld({
    ...seat.world,
    systems,
    player: { ...player, lastClaimTick: currentTick },
  });
  return { ok: true, data: { systemId: input.systemId, nextClaimTick: currentTick + cooldownTicks } };
}
