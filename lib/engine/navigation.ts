/**
 * Pure navigation validation engine.
 * No database dependency — operates entirely on passed-in values.
 */

export interface ConnectionInfo {
  fromSystemId: string;
  toSystemId: string;
  fuelCost: number;
}

export interface NavigationParams {
  currentSystemId: string;
  targetSystemId: string;
  connections: ConnectionInfo[];
  currentFuel: number;
}

export type NavigationResult =
  | { ok: true; fuelCost: number }
  | { ok: false; error: string };

export function validateNavigation(
  params: NavigationParams,
): NavigationResult {
  const { currentSystemId, targetSystemId, connections, currentFuel } = params;

  if (currentSystemId === targetSystemId) {
    return { ok: false, error: "Already in that system." };
  }

  // Find a connection from current to target
  const connection = connections.find(
    (c) =>
      c.fromSystemId === currentSystemId && c.toSystemId === targetSystemId,
  );

  if (!connection) {
    return {
      ok: false,
      error: `No direct connection from ${currentSystemId} to ${targetSystemId}.`,
    };
  }

  if (currentFuel < connection.fuelCost) {
    return {
      ok: false,
      error: `Not enough fuel. Need ${connection.fuelCost}, have ${currentFuel}.`,
    };
  }

  return { ok: true, fuelCost: connection.fuelCost };
}
