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
  type ShipDangerModifiers,
} from "@/lib/engine/danger";
import { rollDamageOnArrival, computeEscortProtection, type DamageResult } from "@/lib/engine/damage";
import { computeUpgradeBonuses, type InstalledModule } from "@/lib/engine/upgrades";
import { computeTraitDanger } from "@/lib/engine/trait-gen";
import type { ModifierRow } from "@/lib/engine/events";
import { GOVERNMENT_TYPES } from "@/lib/constants/government";
import { GOODS } from "@/lib/constants/goods";
import { toGovernmentType, toTraitId, toQualityTier } from "@/lib/types/guards";
import { createNotifications } from "@/lib/services/notifications";
import type { EntityRef } from "@/lib/types/game";
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
  damageResult?: DamageResult;
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
        hullMax: true,
        hullCurrent: true,
        shieldMax: true,
        shieldCurrent: true,
        firepower: true,
        evasion: true,
        stealth: true,
        cargo: { select: { id: true, goodId: true, quantity: true } },
        destination: { select: { name: true, region: { select: { governmentType: true } }, traits: { select: { traitId: true, quality: true } } } },
        upgradeSlots: {
          where: { moduleId: { not: null } },
          select: { moduleId: true, moduleTier: true, slotType: true },
        },
        convoyMember: { select: { convoyId: true } },
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

    // Group arriving ships by convoy for escort calculations
    const convoyShips = new Map<string, typeof arrivingShips>();
    for (const ship of arrivingShips) {
      const convoyId = ship.convoyMember?.convoyId;
      if (convoyId) {
        const group = convoyShips.get(convoyId) ?? [];
        group.push(ship);
        convoyShips.set(convoyId, group);
      }
    }

    const arrived: ArrivedShip[] = [];

    for (const ship of arrivingShips) {
      if (!ship.destinationSystemId) continue;

      // Compute upgrade bonuses from installed modules
      const installedModules: InstalledModule[] = ship.upgradeSlots
        .filter((s): s is typeof s & { moduleId: string; moduleTier: number } =>
          s.moduleId !== null && s.moduleTier !== null)
        .map((s) => ({ moduleId: s.moduleId, moduleTier: s.moduleTier, slotType: s.slotType }));
      const bonuses = computeUpgradeBonuses(installedModules);

      // Build ship danger modifiers from stats + upgrade bonuses
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

      // Dock the ship and regenerate shields
      await ctx.tx.ship.update({
        where: { id: ship.id },
        data: {
          systemId: ship.destinationSystemId,
          status: "docked",
          destinationSystemId: null,
          departureTick: null,
          arrivalTick: null,
          shieldCurrent: ship.shieldMax, // shields regenerate on dock
        },
      });

      // Compute danger at destination (event modifiers + government baseline + trait modifiers)
      const systemMods = modsBySystem.get(ship.destinationSystemId) ?? [];
      const govType = ship.destination?.region?.governmentType
        ? toGovernmentType(ship.destination.region.governmentType)
        : undefined;
      const govDef = govType ? GOVERNMENT_TYPES[govType] : undefined;
      const govBaseline = govDef?.dangerBaseline ?? 0;
      const destTraits = (ship.destination?.traits ?? []).map((t) => ({
        traitId: toTraitId(t.traitId),
        quality: toQualityTier(t.quality),
      }));
      const traitDanger = computeTraitDanger(destTraits);
      const danger = Math.max(0, Math.min(
        aggregateDangerLevel(systemMods) + govBaseline + traitDanger,
        DANGER_CONSTANTS.MAX_DANGER,
      ));

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

      // ── Stage 1: Hazard incidents (hull reduces severity) ──
      if (localCargo.length > 0) {
        const enriched = localCargo
          .filter((c) => c.quantity > 0)
          .map((c) => ({
            goodId: c.goodId,
            quantity: c.quantity,
            hazard: (GOODS[c.goodId]?.hazard ?? "none") as "none" | "low" | "high",
          }));

        const incidents = rollHazardIncidents(enriched, danger, Math.random, shipMods);
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

      // ── Stage 3: Contraband inspection (stealth reduces chance) ──
      if (govDef && govDef.contraband.length > 0 && govDef.inspectionModifier > 0) {
        const seized = rollContrabandInspection(
          localCargo.filter((c) => c.quantity > 0),
          govDef.contraband,
          govDef.inspectionModifier,
          Math.random,
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

      // ── Stage 4: Event-based cargo loss (evasion reduces probability) ──
      if (danger > 0) {
        const remainingCargo = localCargo.filter((c) => c.quantity > 0);
        if (remainingCargo.length > 0) {
          const losses = rollCargoLoss(danger, remainingCargo, Math.random, shipMods);
          if (losses.length > 0) {
            for (const loss of losses) {
              const item = localCargo.find((c) => c.goodId === loss.goodId);
              if (item) item.quantity = loss.remaining;
            }
            cargoLost = losses;
          }
        }
      }

      // ── Stage 5: Hull/shield damage ──
      let damageResult: DamageResult | undefined;
      if (danger > 0) {
        // Compute escort protection if ship is in a convoy
        const convoyId = ship.convoyMember?.convoyId;
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
          ship.shieldMax, // shields were regenerated on dock, but damage uses pre-dock state
          ship.hullMax,
          ship.hullCurrent,
          Math.random,
          escort,
        );

        if (dmg.shieldDamage > 0 || dmg.hullDamage > 0) {
          damageResult = dmg;

          // Apply damage to hull (shields already regenerated, so hull damage from shields is absorbed)
          const newHull = Math.max(0, ship.hullCurrent - dmg.hullDamage);
          const updateData: Record<string, unknown> = {
            hullCurrent: newHull,
            // Reduce regenerated shields by damage taken
            shieldCurrent: Math.max(0, ship.shieldMax - dmg.shieldDamage),
          };

          if (dmg.disabled) {
            updateData.disabled = true;
            // Delete all cargo when disabled
            await ctx.tx.cargoItem.deleteMany({ where: { shipId: ship.id } });
            // Clear local cargo tracking
            for (const item of localCargo) item.quantity = 0;
          }

          await ctx.tx.ship.update({
            where: { id: ship.id },
            data: updateData,
          });
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
        damageResult,
      });
    }

    // Update convoy status for any convoys that had arriving members
    const convoyIds = [...new Set(
      arrivingShips
        .filter((s) => s.convoyMember?.convoyId)
        .map((s) => s.convoyMember!.convoyId),
    )];

    for (const convoyId of convoyIds) {
      // Check if all members have arrived (no members still in transit)
      const inTransitCount = await ctx.tx.ship.count({
        where: {
          convoyMember: { convoyId },
          status: "in_transit",
        },
      });

      if (inTransitCount === 0) {
        // All members arrived — update convoy to docked
        const firstArrivedMember = arrived.find(
          (a) => arrivingShips.find((s) => s.id === a.shipId)?.convoyMember?.convoyId === convoyId,
        );
        if (firstArrivedMember) {
          await ctx.tx.convoy.update({
            where: { id: convoyId },
            data: {
              status: "docked",
              systemId: firstArrivedMember.systemId,
              destinationSystemId: null,
              departureTick: null,
              arrivalTick: null,
            },
          });
        }
      }
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

      if (a.damageResult && (a.damageResult.hullDamage > 0 || a.damageResult.shieldDamage > 0)) {
        const parts: string[] = [];
        if (a.damageResult.shieldDamage > 0) parts.push(`${a.damageResult.shieldDamage} shield`);
        if (a.damageResult.hullDamage > 0) parts.push(`${a.damageResult.hullDamage} hull`);
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

      existing["gameNotifications"] = notifications;
      playerEvents.set(a.playerId, existing);
    }

    // Persist notifications to DB
    const dbEntries: Array<{
      playerId: string;
      type: string;
      message: string;
      refs: Partial<Record<string, EntityRef>>;
      tick: number;
    }> = [];
    for (const [playerId, events] of playerEvents) {
      const notifications = events["gameNotifications"] ?? [];
      for (const n of notifications) {
        const notif = n as { type: string; message: string; refs: Partial<Record<string, EntityRef>> };
        dbEntries.push({
          playerId,
          type: notif.type,
          message: notif.message,
          refs: notif.refs,
          tick: ctx.tick,
        });
      }
    }
    await createNotifications(ctx.tx, dbEntries);

    return { playerEvents };
  },
};
