import type { ShipState } from "@/lib/types/game";
import type { BadgeColor } from "@/components/ui/badge";
import { getCargoUsed } from "./cargo";

export interface ShipDerivedState {
  fuelPercent: number;
  cargoUsed: number;
  cargoPercent: number;
  hullPercent: number;
  shieldPercent: number;
  isDocked: boolean;
  onMission: boolean;
  needsFuel: boolean;
  isDamaged: boolean;
}

/** Compute commonly-used derived values from a ShipState. */
export function getShipDerivedState(ship: ShipState): ShipDerivedState {
  const cargoUsed = getCargoUsed(ship.cargo);
  const isDocked = ship.status === "docked";
  return {
    fuelPercent: ship.maxFuel > 0 ? (ship.fuel / ship.maxFuel) * 100 : 0,
    cargoUsed,
    cargoPercent: ship.cargoMax > 0 ? (cargoUsed / ship.cargoMax) * 100 : 0,
    hullPercent: ship.hullMax > 0 ? (ship.hullCurrent / ship.hullMax) * 100 : 100,
    shieldPercent: ship.shieldMax > 0 ? (ship.shieldCurrent / ship.shieldMax) * 100 : 100,
    isDocked,
    onMission: ship.activeMission?.status === "in_progress",
    needsFuel: isDocked && ship.fuel < ship.maxFuel,
    isDamaged: ship.hullCurrent < ship.hullMax,
  };
}

export interface ShipStatusInfo {
  label: string;
  color: BadgeColor;
}

/** Determine the status badge label and color for a ship. */
export function getShipStatusInfo(ship: ShipState, inBattle?: boolean): ShipStatusInfo {
  if (ship.disabled) return { label: "Disabled", color: "red" };
  if (inBattle) return { label: "In Battle", color: "purple" };
  if (ship.activeMission?.status === "in_progress") return { label: "On Mission", color: "cyan" };
  if (ship.status === "docked") return { label: "Docked", color: "green" };
  return { label: "In Transit", color: "amber" };
}
