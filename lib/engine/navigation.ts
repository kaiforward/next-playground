/**
 * Pure navigation validation engine.
 * No database dependency — operates entirely on passed-in values.
 */

import { validateRoute } from "./pathfinding";
import { hopDuration } from "./travel";

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

// ── Fleet-aware navigation ──────────────────────────────────────

import type { ShipStatus } from "../types/game";

export interface FleetNavigationParams extends NavigationParams {
  shipStatus: ShipStatus;
  currentTick: number;
}

export type FleetNavigationResult =
  | { ok: true; fuelCost: number; travelDuration: number; departureTick: number; arrivalTick: number }
  | { ok: false; error: string };

export function validateFleetNavigation(
  params: FleetNavigationParams,
): FleetNavigationResult {
  const { shipStatus, currentTick, ...navParams } = params;

  if (shipStatus !== "docked") {
    return { ok: false, error: "Ship must be docked to navigate." };
  }

  const baseResult = validateNavigation(navParams);
  if (!baseResult.ok) {
    return baseResult;
  }

  const travelDuration = hopDuration(baseResult.fuelCost);
  const departureTick = currentTick;
  const arrivalTick = currentTick + travelDuration;

  return {
    ok: true,
    fuelCost: baseResult.fuelCost,
    travelDuration,
    departureTick,
    arrivalTick,
  };
}

// ── Multi-hop route navigation ─────────────────────────────────

export interface FleetRouteNavigationParams {
  route: string[];
  connections: ConnectionInfo[];
  currentFuel: number;
  shipStatus: ShipStatus;
  currentTick: number;
}

export type FleetRouteNavigationResult =
  | {
      ok: true;
      totalFuelCost: number;
      totalTravelDuration: number;
      departureTick: number;
      arrivalTick: number;
      destinationSystemId: string;
    }
  | { ok: false; error: string };

export function validateFleetRouteNavigation(
  params: FleetRouteNavigationParams,
): FleetRouteNavigationResult {
  const { route, connections, currentFuel, shipStatus, currentTick } = params;

  if (shipStatus !== "docked") {
    return { ok: false, error: "Ship must be docked to navigate." };
  }

  const routeResult = validateRoute(route, connections, currentFuel);
  if (!routeResult.ok) {
    return { ok: false, error: routeResult.error };
  }

  const departureTick = currentTick;
  const arrivalTick = currentTick + routeResult.totalTravelDuration;
  const destinationSystemId = route[route.length - 1];

  return {
    ok: true,
    totalFuelCost: routeResult.totalFuelCost,
    totalTravelDuration: routeResult.totalTravelDuration,
    departureTick,
    arrivalTick,
    destinationSystemId,
  };
}
