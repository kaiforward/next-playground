/**
 * Player pin verb — the mutation half of the Tracker's "Pinned systems" list
 * (docs/active/gameplay/tracker.md). Pinning is a bookmark: it does not check ownership or even that
 * the system currently exists (a pin surviving past abandonment is filtered on read, not rejected on
 * write — Task 3). `pinnedSystemIds` is insertion-ordered and deduplicated here so no reader has to.
 */
import { getWorld, hasWorld, setWorld } from "@/lib/world/store";

export type SetSystemPinResult =
  | { ok: true; data: string[] }
  | { ok: false; error: string };

export function setSystemPin(input: { systemId: string; pinned: boolean }): SetSystemPinResult {
  if (!hasWorld()) return { ok: false, error: "No world loaded." };
  const world = getWorld();
  const player = world.player;
  if (!player) return { ok: false, error: "This world has no player seat." };

  const already = player.pinnedSystemIds.includes(input.systemId);
  let pinnedSystemIds: string[];
  if (input.pinned) {
    pinnedSystemIds = already
      ? player.pinnedSystemIds
      : [...player.pinnedSystemIds, input.systemId];
  } else {
    pinnedSystemIds = already
      ? player.pinnedSystemIds.filter((id) => id !== input.systemId)
      : player.pinnedSystemIds;
  }

  // Skip the write entirely when nothing changed — pinning an already-pinned system or unpinning one
  // that was never pinned is a no-op, not a fresh array identity.
  if (pinnedSystemIds === player.pinnedSystemIds) {
    return { ok: true, data: pinnedSystemIds };
  }

  setWorld({ ...world, player: { ...player, pinnedSystemIds } });
  return { ok: true, data: pinnedSystemIds };
}
