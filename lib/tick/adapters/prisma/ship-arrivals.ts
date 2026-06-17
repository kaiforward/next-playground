import type { TxClient, PlayerEventMap } from "@/lib/tick/types";
import type {
  ArrivingShipView,
  CargoMutation,
  DockShipUpdate,
  ShipArrivalsWorld,
  ShipDamageUpdate,
} from "@/lib/tick/world/ship-arrivals-world";
import type { ModifierRow } from "@/lib/engine/events";
import { persistPlayerNotifications } from "@/lib/tick/helpers";
import { toGovernmentType, toTraitId, toQualityTier } from "@/lib/types/guards";

/** Live-game adapter for the ship-arrivals processor. */
export class PrismaShipArrivalsWorld implements ShipArrivalsWorld {
  constructor(private tx: TxClient) {}

  async getArrivingShips(currentTick: number): Promise<ArrivingShipView[]> {
    const rows = await this.tx.ship.findMany({
      where: { status: "in_transit", arrivalTick: { lte: currentTick } },
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
        destination: {
          select: {
            name: true,
            bodyDanger: true,
            faction: { select: { governmentType: true } },
            traits: { select: { traitId: true, quality: true } },
          },
        },
        upgradeSlots: {
          where: { moduleId: { not: null } },
          select: { moduleId: true, moduleTier: true, slotType: true },
        },
        convoyMember: { select: { convoyId: true } },
      },
    });

    return rows.map((s) => ({
      id: s.id,
      name: s.name,
      destinationSystemId: s.destinationSystemId,
      playerId: s.playerId,
      hullMax: s.hullMax,
      hullCurrent: s.hullCurrent,
      shieldMax: s.shieldMax,
      shieldCurrent: s.shieldCurrent,
      firepower: s.firepower,
      evasion: s.evasion,
      stealth: s.stealth,
      cargo: s.cargo,
      destination: s.destination
        ? {
            name: s.destination.name,
            governmentType: s.destination.faction?.governmentType
              ? toGovernmentType(s.destination.faction.governmentType)
              : null,
            traits: s.destination.traits.map((t) => ({
              traitId: toTraitId(t.traitId),
              quality: toQualityTier(t.quality),
            })),
            bodyDanger: s.destination.bodyDanger,
          }
        : null,
      upgradeSlots: s.upgradeSlots,
      convoyId: s.convoyMember?.convoyId ?? null,
    }));
  }

  async getNavModifiersForSystems(
    systemIds: string[],
  ): Promise<ModifierRow[]> {
    if (systemIds.length === 0) return [];
    return this.tx.eventModifier.findMany({
      where: {
        domain: "navigation",
        targetType: "system",
        targetId: { in: systemIds },
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
    });
  }

  async dockShip(update: DockShipUpdate): Promise<void> {
    await this.tx.ship.update({
      where: { id: update.shipId },
      data: {
        systemId: update.destinationSystemId,
        status: "docked",
        destinationSystemId: null,
        departureTick: null,
        arrivalTick: null,
        shieldCurrent: update.shieldCurrent,
      },
    });
  }

  async applyShipDamage(update: ShipDamageUpdate): Promise<void> {
    if (update.clearCargo) {
      await this.tx.cargoItem.deleteMany({ where: { shipId: update.shipId } });
    }
    await this.tx.ship.update({
      where: { id: update.shipId },
      data: {
        hullCurrent: update.hullCurrent,
        shieldCurrent: update.shieldCurrent,
        ...(update.disabled ? { disabled: true } : {}),
      },
    });
  }

  async applyCargoMutations(mutations: CargoMutation[]): Promise<void> {
    for (const m of mutations) {
      if (m.newQuantity <= 0) {
        await this.tx.cargoItem.delete({ where: { id: m.cargoItemId } });
      } else {
        await this.tx.cargoItem.update({
          where: { id: m.cargoItemId },
          data: { quantity: m.newQuantity },
        });
      }
    }
  }

  async countInTransitConvoyMembers(convoyId: string): Promise<number> {
    return this.tx.ship.count({
      where: { convoyMember: { convoyId }, status: "in_transit" },
    });
  }

  async dockConvoy(convoyId: string, systemId: string): Promise<void> {
    await this.tx.convoy.update({
      where: { id: convoyId },
      data: {
        status: "docked",
        systemId,
        destinationSystemId: null,
        departureTick: null,
        arrivalTick: null,
      },
    });
  }

  async persistNotifications(
    events: Map<string, Partial<PlayerEventMap>>,
    tick: number,
  ): Promise<void> {
    await persistPlayerNotifications(this.tx, events, tick);
  }
}
