import {
  aggregateDangerLevel,
  DANGER_CONSTANTS,
  rollCargoLoss,
  rollHazardIncidents,
  applyImportDuty,
  rollContrabandInspection,
  type CargoLossEntry,
  type HazardIncidentEntry,
  type ImportDutyEntry,
  type ContrabandSeizedEntry,
} from "@/lib/engine/danger";
import type { ModifierRow } from "@/lib/engine/events";
import { GOVERNMENT_TYPES } from "@/lib/constants/government";
import { GOODS } from "@/lib/constants/goods";
import { toGovernmentType } from "@/lib/types/guards";
import type { TickProcessor, TickProcessorResult } from "../types";

interface ArrivedShip {
  shipId: string;
  shipName: string;
  systemId: string;
  destName: string;
  playerId: string;
  hazardIncidents?: HazardIncidentEntry[];
  importDuties?: ImportDutyEntry[];
  contrabandSeized?: ContrabandSeizedEntry[];
  cargoLost?: CargoLossEntry[];
}

export const shipArrivalsProcessor: TickProcessor = {
  name: "ship-arrivals",
  frequency: 1,

  async process(ctx): Promise<TickProcessorResult> {
    const arrivingShips = await ctx.tx.ship.findMany({
      where: {
        status: "in_transit",
        arrivalTick: { lte: ctx.tick },
      },
      select: {
        id: true,
        name: true,
        destinationSystemId: true,
        playerId: true,
        cargo: { select: { id: true, goodId: true, quantity: true } },
        destination: { select: { name: true, region: { select: { governmentType: true } } } },
      },
    });

    if (arrivingShips.length === 0) {
      return {};
    }

    // Collect unique destination system IDs to batch-query navigation modifiers
    const destinationIds = [
      ...new Set(
        arrivingShips
          .map((s) => s.destinationSystemId)
          .filter((id): id is string => id !== null),
      ),
    ];

    // Query all navigation modifiers for destination systems in one go
    const navModifiers = destinationIds.length > 0
      ? await ctx.tx.eventModifier.findMany({
          where: {
            domain: "navigation",
            targetType: "system",
            targetId: { in: destinationIds },
          },
          select: {
            targetId: true,
            domain: true,
            type: true,
            targetType: true,
            goodId: true,
            parameter: true,
            value: true,
          },
        })
      : [];

    // Group modifiers by system ID for quick lookup
    const modsBySystem = new Map<string, ModifierRow[]>();
    for (const mod of navModifiers) {
      if (!mod.targetId) continue;
      const existing = modsBySystem.get(mod.targetId) ?? [];
      existing.push(mod);
      modsBySystem.set(mod.targetId, existing);
    }

    const arrived: ArrivedShip[] = [];

    for (const ship of arrivingShips) {
      if (!ship.destinationSystemId) continue;

      // Dock the ship
      await ctx.tx.ship.update({
        where: { id: ship.id },
        data: {
          systemId: ship.destinationSystemId,
          status: "docked",
          destinationSystemId: null,
          departureTick: null,
          arrivalTick: null,
        },
      });

      // Compute danger at destination (event modifiers + government baseline)
      const systemMods = modsBySystem.get(ship.destinationSystemId) ?? [];
      const govType = ship.destination?.region?.governmentType
        ? toGovernmentType(ship.destination.region.governmentType)
        : undefined;
      const govDef = govType ? GOVERNMENT_TYPES[govType] : undefined;
      const govBaseline = govDef?.dangerBaseline ?? 0;
      const danger = Math.min(
        aggregateDangerLevel(systemMods) + govBaseline,
        DANGER_CONSTANTS.MAX_DANGER,
      );

      // Mutable local cargo tracking — each stage mutates quantities for the next
      const localCargo = ship.cargo.map((c) => ({
        id: c.id,
        goodId: c.goodId,
        quantity: c.quantity,
      }));

      let hazardIncidents: HazardIncidentEntry[] | undefined;
      let importDuties: ImportDutyEntry[] | undefined;
      let contrabandSeized: ContrabandSeizedEntry[] | undefined;
      let cargoLost: CargoLossEntry[] | undefined;

      // ── Stage 1: Hazard incidents ──
      if (localCargo.length > 0) {
        const enriched = localCargo
          .filter((c) => c.quantity > 0)
          .map((c) => ({
            goodId: c.goodId,
            quantity: c.quantity,
            hazard: (GOODS[c.goodId]?.hazard ?? "none") as "none" | "low" | "high",
          }));

        const incidents = rollHazardIncidents(enriched, danger, Math.random);
        if (incidents.length > 0) {
          for (const inc of incidents) {
            const item = localCargo.find((c) => c.goodId === inc.goodId);
            if (item) item.quantity = inc.remaining;
          }
          hazardIncidents = incidents;
        }
      }

      // ── Stage 2: Import duty (taxed goods) ──
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

      // ── Stage 3: Contraband inspection ──
      if (govDef && govDef.contraband.length > 0 && govDef.inspectionModifier > 0) {
        const seized = rollContrabandInspection(
          localCargo.filter((c) => c.quantity > 0),
          govDef.contraband,
          govDef.inspectionModifier,
          Math.random,
        );
        if (seized.length > 0) {
          for (const s of seized) {
            const item = localCargo.find((c) => c.goodId === s.goodId);
            if (item) item.quantity = 0;
          }
          contrabandSeized = seized;
        }
      }

      // ── Stage 4: Existing event-based danger (operates on reduced cargo) ──
      if (danger > 0) {
        const remainingCargo = localCargo.filter((c) => c.quantity > 0);
        if (remainingCargo.length > 0) {
          const losses = rollCargoLoss(danger, remainingCargo, Math.random);
          if (losses.length > 0) {
            for (const loss of losses) {
              const item = localCargo.find((c) => c.goodId === loss.goodId);
              if (item) item.quantity = loss.remaining;
            }
            cargoLost = losses;
          }
        }
      }

      // ── Persist cargo changes to DB ──
      for (const item of localCargo) {
        const original = ship.cargo.find((c) => c.goodId === item.goodId);
        if (!original || original.quantity === item.quantity) continue;

        if (item.quantity <= 0) {
          await ctx.tx.cargoItem.delete({ where: { id: original.id } });
        } else {
          await ctx.tx.cargoItem.update({
            where: { id: original.id },
            data: { quantity: item.quantity },
          });
        }
      }

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
      });
    }

    // Group arrivals by player for scoped events
    const playerEvents = new Map<string, Record<string, unknown[]>>();
    for (const a of arrived) {
      const existing = playerEvents.get(a.playerId) ?? {};
      existing["shipArrived"] = [...(existing["shipArrived"] ?? []), a];

      // Emit separate cargoLost event if losses occurred
      if (a.cargoLost && a.cargoLost.length > 0) {
        existing["cargoLost"] = [
          ...(existing["cargoLost"] ?? []),
          { shipId: a.shipId, systemId: a.systemId, losses: a.cargoLost },
        ];
      }

      // Emit gameNotifications for the notification system
      const notifications = existing["gameNotifications"] ?? [];
      const shipRef = { id: a.shipId, label: a.shipName };
      const systemRef = { id: a.systemId, label: a.destName };

      notifications.push({
        message: `${a.shipName} arrived at ${a.destName}`,
        type: "ship_arrived",
        refs: { ship: shipRef, system: systemRef },
      });

      if (a.hazardIncidents && a.hazardIncidents.length > 0) {
        const goodNames = a.hazardIncidents.map((i) => GOODS[i.goodId]?.name ?? i.goodId).join(", ");
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

      existing["gameNotifications"] = notifications;
      playerEvents.set(a.playerId, existing);
    }

    return { playerEvents };
  },
};
