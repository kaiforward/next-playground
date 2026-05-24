import type { TxClient, PlayerEventMap } from "@/lib/tick/types";
import type {
  ActiveBattleView,
  BattleResolution,
  BattlesWorld,
  OngoingBattleUpdate,
  ShipDamageApply,
} from "@/lib/tick/world/battles-world";
import type { RoundResult } from "@/lib/engine/combat";
import { persistPlayerNotifications } from "@/lib/tick/helpers";

/** Live-game adapter for the battles processor. */
export class PrismaBattlesWorld implements BattlesWorld {
  constructor(private tx: TxClient) {}

  async getActiveBattlesDue(
    currentTick: number,
  ): Promise<ActiveBattleView[]> {
    const rows = await this.tx.battle.findMany({
      where: { status: "active", nextRoundTick: { lte: currentTick } },
      include: {
        ship: {
          select: {
            id: true,
            name: true,
            playerId: true,
            hullMax: true,
            hullCurrent: true,
            shieldMax: true,
            shieldCurrent: true,
            firepower: true,
            evasion: true,
          },
        },
        mission: { select: { id: true, reward: true, type: true } },
        system: { select: { name: true } },
      },
    });

    return rows.map((b) => {
      const history: RoundResult[] = JSON.parse(b.roundHistory);
      return {
        id: b.id,
        systemId: b.systemId,
        systemName: b.system.name,
        playerStrength: b.playerStrength,
        playerMorale: b.playerMorale,
        enemyStrength: b.enemyStrength,
        enemyMorale: b.enemyMorale,
        enemyTier: b.enemyTier,
        dangerLevel: b.dangerLevel,
        initialPlayerStrength: b.initialPlayerStrength,
        roundsCompleted: b.roundsCompleted,
        roundInterval: b.roundInterval,
        roundHistory: history,
        ship: b.ship,
        mission: b.mission,
      };
    });
  }

  async markBattleDefeated(
    battleId: string,
    currentTick: number,
  ): Promise<void> {
    await this.tx.battle.update({
      where: { id: battleId },
      data: { status: "player_defeat", resolvedAtTick: currentTick },
    });
  }

  async updateOngoingBattle(update: OngoingBattleUpdate): Promise<void> {
    await this.tx.battle.update({
      where: { id: update.battleId },
      data: {
        playerStrength: update.playerStrength,
        playerMorale: update.playerMorale,
        enemyStrength: update.enemyStrength,
        enemyMorale: update.enemyMorale,
        roundsCompleted: { increment: 1 },
        nextRoundTick: update.nextRoundTick,
        roundHistory: JSON.stringify(update.roundHistory),
      },
    });
  }

  async resolveBattleRecord(resolution: BattleResolution): Promise<void> {
    await this.tx.battle.update({
      where: { id: resolution.battleId },
      data: {
        status: resolution.outcome,
        playerStrength: resolution.playerStrength,
        playerMorale: resolution.playerMorale,
        enemyStrength: resolution.enemyStrength,
        enemyMorale: resolution.enemyMorale,
        roundsCompleted: { increment: 1 },
        roundHistory: JSON.stringify(resolution.roundHistory),
        resolvedAtTick: resolution.resolvedAtTick,
      },
    });
  }

  async applyShipDamage(damage: ShipDamageApply): Promise<void> {
    if (damage.disabled) {
      await this.tx.cargoItem.deleteMany({ where: { shipId: damage.shipId } });
    }
    await this.tx.ship.update({
      where: { id: damage.shipId },
      data: {
        shieldCurrent: damage.shieldCurrent,
        hullCurrent: damage.hullCurrent,
        ...(damage.disabled ? { disabled: true } : {}),
      },
    });
  }

  async completeMissionAndReward(
    missionId: string,
    playerId: string,
    reward: number,
    currentTick: number,
  ): Promise<void> {
    await this.tx.mission.update({
      where: { id: missionId },
      data: {
        status: "completed",
        completedAtTick: currentTick,
        shipId: null,
      },
    });
    await this.tx.player.update({
      where: { id: playerId },
      data: { credits: { increment: reward } },
    });
  }

  async failMission(missionId: string): Promise<void> {
    await this.tx.mission.update({
      where: { id: missionId },
      data: { status: "failed", shipId: null },
    });
  }

  async persistNotifications(
    events: Map<string, Partial<PlayerEventMap>>,
    tick: number,
  ): Promise<void> {
    await persistPlayerNotifications(this.tx, events, tick);
  }
}
