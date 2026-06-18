import {
  computeSystemDanger,
  rollCargoLoss,
  rollHazardIncidents,
  applyImportDuty,
  rollContrabandInspection,
  type CargoLossEntry,
  type HazardIncidentEntry,
  type ImportDutyEntry,
  type ContrabandSeizedEntry,
  type ShipDangerModifiers,
} from "@/lib/engine/danger";
import {
  rollDamageOnArrival,
  computeEscortProtection,
  type DamageResult,
} from "@/lib/engine/damage";
import { computeUpgradeBonuses } from "@/lib/engine/upgrades";
import { getInstalledModules } from "@/lib/utils/ship";
import { computeTraitDanger } from "@/lib/engine/trait-gen";

import { GOVERNMENT_TYPES } from "@/lib/constants/government";
import { GOODS } from "@/lib/constants/goods";
import { toHazard } from "@/lib/types/guards";
import { groupModifiersByTarget } from "../helpers";
import type {
  TickContext,
  TickProcessor,
  TickProcessorResult,
  ShipArrivedPayload,
  CargoLostPayload,
  GameNotificationPayload,
  PlayerEventMap,
} from "../types";
import { PrismaShipArrivalsWorld } from "@/lib/tick/adapters/prisma/ship-arrivals";
import type {
  ArrivingShipView,
  CargoMutation,
  ShipArrivalsWorld,
} from "@/lib/tick/world/ship-arrivals-world";

export interface ShipArrivalsProcessorParams {
  rng: () => number;
}

/**
 * Pure processor body. Depends only on `ShipArrivalsWorld` + an injected
 * RNG. Live game owns the orchestration; the simulator keeps its own ship
 * arrival path for now (see ShipArrivalsWorld doc-comment).
 */
export async function runShipArrivalsProcessor(
  world: ShipArrivalsWorld,
  ctx: TickContext,
  params: ShipArrivalsProcessorParams,
): Promise<TickProcessorResult> {
  const { rng } = params;
  const arrivingShips = await world.getArrivingShips(ctx.tick);
  if (arrivingShips.length === 0) return {};

  const destinationIds = [
    ...new Set(
      arrivingShips
        .map((s) => s.destinationSystemId)
        .filter((id): id is string => id !== null),
    ),
  ];

  const navModifiers = await world.getNavModifiersForSystems(destinationIds);
  const modsBySystem = groupModifiersByTarget(navModifiers);

  // Group arriving ships by convoy for escort calculations.
  const convoyShips = new Map<string, ArrivingShipView[]>();
  for (const ship of arrivingShips) {
    if (!ship.convoyId) continue;
    const group = convoyShips.get(ship.convoyId) ?? [];
    group.push(ship);
    convoyShips.set(ship.convoyId, group);
  }

  const arrived: ShipArrivedPayload[] = [];

  for (const ship of arrivingShips) {
    if (!ship.destinationSystemId) continue;

    const bonuses = computeUpgradeBonuses(getInstalledModules(ship.upgradeSlots));

    const shipMods: ShipDangerModifiers = {
      hullStat: ship.hullMax,
      armourBonus: bonuses.hullBonus,
      reinforcedContainersBonus: bonuses.lossSeverityReduction,
      stealthStat: ship.stealth,
      hiddenCargoFraction: bonuses.hiddenCargoFraction,
      evasionStat: ship.evasion,
      manoeuvringBonus: bonuses.evasionBonus,
      pointDefenceReduction: bonuses.cargoLossProbReduction,
    };

    // Dock the ship and regenerate shields.
    await world.dockShip({
      shipId: ship.id,
      destinationSystemId: ship.destinationSystemId,
      shieldCurrent: ship.shieldMax,
    });

    // Compute danger at destination.
    const systemMods = modsBySystem.get(ship.destinationSystemId) ?? [];
    const govDef = ship.destination?.governmentType
      ? GOVERNMENT_TYPES[ship.destination.governmentType]
      : undefined;
    const govBaseline = govDef?.dangerBaseline ?? 0;
    const traitDanger = ship.destination
      ? computeTraitDanger(ship.destination.traits)
      : 0;
    const danger = computeSystemDanger(
      systemMods,
      govBaseline,
      traitDanger,
      ship.destination?.bodyDanger ?? 0,
    );

    // Mutable local cargo — each stage mutates the next stage's input.
    const localCargo = ship.cargo.map((c) => ({
      id: c.id,
      goodId: c.goodId,
      quantity: c.quantity,
    }));

    let hazardIncidents: HazardIncidentEntry[] | undefined;
    let importDuties: ImportDutyEntry[] | undefined;
    let contrabandSeized: ContrabandSeizedEntry[] | undefined;
    let cargoLost: CargoLossEntry[] | undefined;

    // Stage 1: hazard incidents.
    if (localCargo.length > 0) {
      const enriched = localCargo
        .filter((c) => c.quantity > 0)
        .map((c) => ({
          goodId: c.goodId,
          quantity: c.quantity,
          hazard: toHazard(GOODS[c.goodId]?.hazard ?? "none"),
        }));
      const incidents = rollHazardIncidents(enriched, danger, rng, shipMods);
      if (incidents.length > 0) {
        for (const inc of incidents) {
          const item = localCargo.find((c) => c.goodId === inc.goodId);
          if (item) item.quantity = inc.remaining;
        }
        hazardIncidents = incidents;
      }
    }

    // Stage 2: import duty.
    if (govDef && govDef.taxed.length > 0 && govDef.taxRate > 0) {
      const duties = applyImportDuty(
        localCargo.filter((c) => c.quantity > 0),
        govDef.taxed,
        govDef.taxRate,
      );
      if (duties.length > 0) {
        for (const duty of duties) {
          const item = localCargo.find((c) => c.goodId === duty.goodId);
          if (item) item.quantity = duty.remaining;
        }
        importDuties = duties;
      }
    }

    // Stage 3: contraband inspection.
    if (govDef && govDef.contraband.length > 0 && govDef.inspectionModifier > 0) {
      const seized = rollContrabandInspection(
        localCargo.filter((c) => c.quantity > 0),
        govDef.contraband,
        govDef.inspectionModifier,
        rng,
        shipMods,
      );
      if (seized.length > 0) {
        for (const s of seized) {
          const item = localCargo.find((c) => c.goodId === s.goodId);
          if (item) item.quantity = Math.max(0, item.quantity - s.seized);
        }
        contrabandSeized = seized;
      }
    }

    // Stage 4: event-based cargo loss.
    if (danger > 0) {
      const remaining = localCargo.filter((c) => c.quantity > 0);
      if (remaining.length > 0) {
        const losses = rollCargoLoss(danger, remaining, rng, shipMods);
        if (losses.length > 0) {
          for (const loss of losses) {
            const item = localCargo.find((c) => c.goodId === loss.goodId);
            if (item) item.quantity = loss.remaining;
          }
          cargoLost = losses;
        }
      }
    }

    // Stage 5: hull/shield damage.
    let damageResult: DamageResult | undefined;
    if (danger > 0) {
      const convoyId = ship.convoyId;
      let escort;
      if (convoyId) {
        const convoyGroup = convoyShips.get(convoyId) ?? [];
        const escortShips = convoyGroup
          .filter((s) => s.id !== ship.id)
          .map((s) => ({ firepower: s.firepower }));
        if (escortShips.length > 0) {
          escort = computeEscortProtection(escortShips);
        }
      }

      const dmg = rollDamageOnArrival(
        danger,
        ship.shieldMax,
        ship.shieldMax, // shields regenerated on dock; damage uses pre-dock state.
        ship.hullMax,
        ship.hullCurrent,
        rng,
        escort,
      );

      if (dmg.shieldDamage > 0 || dmg.hullDamage > 0) {
        damageResult = dmg;
        const newHull = Math.max(0, ship.hullCurrent - dmg.hullDamage);

        if (dmg.disabled) {
          for (const item of localCargo) item.quantity = 0;
        }

        await world.applyShipDamage({
          shipId: ship.id,
          hullCurrent: newHull,
          shieldCurrent: Math.max(0, ship.shieldMax - dmg.shieldDamage),
          disabled: dmg.disabled,
          clearCargo: dmg.disabled,
        });
      }
    }

    // Persist cargo changes.
    const mutations: CargoMutation[] = [];
    for (const item of localCargo) {
      const original = ship.cargo.find((c) => c.goodId === item.goodId);
      if (!original || original.quantity === item.quantity) continue;
      mutations.push({ cargoItemId: original.id, newQuantity: item.quantity });
    }
    await world.applyCargoMutations(mutations);

    arrived.push({
      shipId: ship.id,
      shipName: ship.name,
      systemId: ship.destinationSystemId,
      destName: ship.destination?.name ?? "Unknown",
      playerId: ship.playerId,
      hazardIncidents,
      importDuties,
      contrabandSeized,
      cargoLost,
      damageResult,
    });
  }

  // Convoy status updates for any convoys whose members have all arrived.
  const convoyIds = [...new Set(
    arrivingShips
      .map((s) => s.convoyId)
      .filter((id): id is string => id !== null),
  )];

  for (const convoyId of convoyIds) {
    const inTransitCount = await world.countInTransitConvoyMembers(convoyId);
    if (inTransitCount > 0) continue;

    const firstArrived = arrived.find((a) => {
      const ship = arrivingShips.find((s) => s.id === a.shipId);
      return ship?.convoyId === convoyId;
    });
    if (!firstArrived) continue;

    await world.dockConvoy(convoyId, firstArrived.systemId);
  }

  // Build per-player event payloads + notifications.
  const playerEvents = new Map<string, Partial<PlayerEventMap>>();
  for (const a of arrived) {
    const existing = playerEvents.get(a.playerId) ?? {};
    existing.shipArrived = existing.shipArrived
      ? [...existing.shipArrived, a]
      : [a];

    if (a.cargoLost && a.cargoLost.length > 0) {
      const loss: CargoLostPayload = {
        shipId: a.shipId,
        systemId: a.systemId,
        losses: a.cargoLost,
      };
      existing.cargoLost = existing.cargoLost
        ? [...existing.cargoLost, loss]
        : [loss];
    }

    const notifications: GameNotificationPayload[] = existing.gameNotifications
      ? [...existing.gameNotifications]
      : [];
    const shipRef = { id: a.shipId, label: a.shipName };
    const systemRef = { id: a.systemId, label: a.destName };

    notifications.push({
      message: `${a.shipName} arrived at ${a.destName}`,
      type: "ship_arrived",
      refs: { ship: shipRef, system: systemRef },
    });

    if (a.hazardIncidents && a.hazardIncidents.length > 0) {
      const goodNames = a.hazardIncidents
        .map((i) => GOODS[i.goodId]?.name ?? i.goodId)
        .join(", ");
      notifications.push({
        message: `${a.shipName}: hazard incident — ${goodNames} damaged near ${a.destName}`,
        type: "hazard_incident",
        refs: { ship: shipRef, system: systemRef },
      });
    }

    if (a.importDuties && a.importDuties.length > 0) {
      const details = a.importDuties
        .map((d) => `${d.seized} ${GOODS[d.goodId]?.name ?? d.goodId}`)
        .join(", ");
      notifications.push({
        message: `${a.shipName}: import duty — ${details} seized at ${a.destName}`,
        type: "import_duty",
        refs: { ship: shipRef, system: systemRef },
      });
    }

    if (a.contrabandSeized && a.contrabandSeized.length > 0) {
      const details = a.contrabandSeized
        .map((s) => `${s.seized} ${GOODS[s.goodId]?.name ?? s.goodId}`)
        .join(", ");
      notifications.push({
        message: `${a.shipName}: contraband confiscated — ${details} at ${a.destName}`,
        type: "contraband_seized",
        refs: { ship: shipRef, system: systemRef },
      });
    }

    if (a.cargoLost && a.cargoLost.length > 0) {
      notifications.push({
        message: `${a.shipName} lost cargo near ${a.destName}`,
        type: "cargo_lost",
        refs: { ship: shipRef, system: systemRef },
      });
    }

    if (
      a.damageResult &&
      (a.damageResult.hullDamage > 0 || a.damageResult.shieldDamage > 0)
    ) {
      const parts: string[] = [];
      if (a.damageResult.shieldDamage > 0)
        parts.push(`${a.damageResult.shieldDamage} shield`);
      if (a.damageResult.hullDamage > 0)
        parts.push(`${a.damageResult.hullDamage} hull`);
      notifications.push({
        message: `${a.shipName} took ${parts.join(" + ")} damage near ${a.destName}`,
        type: "ship_damaged",
        refs: { ship: shipRef, system: systemRef },
      });
      if (a.damageResult.disabled) {
        notifications.push({
          message: `${a.shipName} was disabled! All cargo lost.`,
          type: "ship_disabled",
          refs: { ship: shipRef, system: systemRef },
        });
      }
    }

    existing.gameNotifications = notifications;
    playerEvents.set(a.playerId, existing);
  }

  await world.persistNotifications(playerEvents, ctx.tick);

  return { playerEvents };
}

// ── Live-game wiring ──────────────────────────────────────────────

export const shipArrivalsProcessor: TickProcessor = {
  name: "ship-arrivals",
  frequency: 1,

  async process(ctx): Promise<TickProcessorResult> {
    const world = new PrismaShipArrivalsWorld(ctx.tx);
    return runShipArrivalsProcessor(world, ctx, { rng: Math.random });
  },
};
