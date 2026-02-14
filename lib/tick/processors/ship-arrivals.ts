import { aggregateDangerLevel, DANGER_CONSTANTS, rollCargoLoss, type CargoLossEntry } from "@/lib/engine/danger";
import type { ModifierRow } from "@/lib/engine/events";
import { GOVERNMENT_TYPES } from "@/lib/constants/government";
import type { GovernmentType } from "@/lib/types/game";
import type { TickProcessor, TickProcessorResult } from "../types";

interface ArrivedShip {
  shipId: string;
  shipName: string;
  systemId: string;
  destName: string;
  playerId: string;
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
      existing.push(mod as ModifierRow);
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

      // Check danger at destination (event modifiers + government baseline)
      const systemMods = modsBySystem.get(ship.destinationSystemId) ?? [];
      const govType = ship.destination?.region?.governmentType as GovernmentType | undefined;
      const govBaseline = govType ? (GOVERNMENT_TYPES[govType]?.dangerBaseline ?? 0) : 0;
      const danger = Math.min(
        aggregateDangerLevel(systemMods) + govBaseline,
        DANGER_CONSTANTS.MAX_DANGER,
      );
      let cargoLost: CargoLossEntry[] | undefined;

      if (danger > 0 && ship.cargo.length > 0) {
        const losses = rollCargoLoss(
          danger,
          ship.cargo,
          Math.random,
        );

        if (losses.length > 0) {
          // Apply cargo losses in DB
          for (const loss of losses) {
            const cargoItem = ship.cargo.find((c) => c.goodId === loss.goodId);
            if (!cargoItem) continue;

            if (loss.remaining <= 0) {
              await ctx.tx.cargoItem.delete({ where: { id: cargoItem.id } });
            } else {
              await ctx.tx.cargoItem.update({
                where: { id: cargoItem.id },
                data: { quantity: loss.remaining },
              });
            }
          }
          cargoLost = losses;
        }
      }

      arrived.push({
        shipId: ship.id,
        shipName: ship.name,
        systemId: ship.destinationSystemId,
        destName: ship.destination?.name ?? "Unknown",
        playerId: ship.playerId,
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
