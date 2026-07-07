"use client";

import type { FleetState } from "@/lib/types/game";

/**
 * The player fleet died with the pivot — its API route and service are gone,
 * and the ship/fleet UI that still consumes this hook is removed next. Until
 * then, serve the honest empty state (a fresh world seeds no ships) so every
 * consumer renders instead of choking on a 404.
 */
const EMPTY_FLEET: FleetState = {
  id: "fleet",
  userId: "",
  credits: 0,
  ships: [],
};

export function useFleet() {
  return { fleet: EMPTY_FLEET };
}
