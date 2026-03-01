import type {
  TickProcessor,
  TickProcessorResult,
  GameNotificationPayload,
  PlayerEventMap,
} from "../types";
import { persistPlayerNotifications } from "../helpers";
import {
  resolveRound,
  checkBattleEnd,
  calculateBattleDamage,
  type CombatStats,
  type BattleOutcome,
  type RoundResult,
} from "@/lib/engine/combat";
import { COMBAT_CONSTANTS, ENEMY_TIERS } from "@/lib/constants/combat";
import { isEnemyTier } from "@/lib/types/guards";
import type { NotificationType } from "@/lib/types/game";

export const battlesProcessor: TickProcessor = {
  name: "battles",
  frequency: 1,
  dependsOn: ["ship-arrivals"],

  async process(ctx): Promise<TickProcessorResult> {
    // Find active battles where it's time for the next round
    const activeBattles = await ctx.tx.battle.findMany({
      where: {
        status: "active",
        nextRoundTick: { lte: ctx.tick },
      },
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
          },
        },
        mission: {
          select: { id: true, reward: true, type: true },
        },
        system: {
          select: { name: true },
        },
      },
    });

    if (activeBattles.length === 0) {
      return {};
    }

    const playerEvents = new Map<string, Partial<PlayerEventMap>>();

    for (const battle of activeBattles) {
      if (!battle.ship) {
        // Ship was destroyed/removed — end battle as defeat
        await ctx.tx.battle.update({
          where: { id: battle.id },
          data: {
            status: "player_defeat",
            resolvedAtTick: ctx.tick,
          },
        });
        if (battle.mission) {
          await ctx.tx.mission.update({
            where: { id: battle.mission.id },
            data: { status: "failed", shipId: null },
          });
        }
        continue;
      }

      const roundHistory: RoundResult[] = JSON.parse(battle.roundHistory);

      // Use ship stats to derive per-round damage (same as combat engine)
      const { FIREPOWER_TO_DAMAGE, EVASION_K, MAX_EVASION_REDUCTION } = COMBAT_CONSTANTS;

      // We need the ship's firepower/evasion. Since these aren't on the battle record,
      // fetch them from the ship.
      const shipStats = await ctx.tx.ship.findUnique({
        where: { id: battle.ship.id },
        select: { firepower: true, evasion: true },
      });

      if (!shipStats) continue;

      const playerDamagePerRound = shipStats.firepower * FIREPOWER_TO_DAMAGE;
      const rawReduction = shipStats.evasion / (shipStats.evasion + EVASION_K);
      const playerDamageReduction = Math.min(rawReduction, MAX_EVASION_REDUCTION);

      const playerStats: CombatStats = {
        strength: battle.playerStrength,
        morale: battle.playerMorale,
        damagePerRound: playerDamagePerRound,
        damageReduction: playerDamageReduction,
      };

      // Enemy stats from battle record — derive damage from tier
      const eTier = battle.enemyTier;
      const tierDef = isEnemyTier(eTier) ? ENEMY_TIERS[eTier] : null;
      const dangerScale = battle.dangerLevel != null
        ? (0.6 + battle.dangerLevel * 0.8)
        : 0.8;

      const enemyStats: CombatStats = {
        strength: battle.enemyStrength,
        morale: battle.enemyMorale,
        damagePerRound: tierDef
          ? Math.round(tierDef.baseDamagePerRound * dangerScale * 10) / 10
          : 5,
        damageReduction: tierDef ? tierDef.baseDamageReduction : 0.05,
      };

      // Resolve the round
      const result = resolveRound(
        playerStats,
        enemyStats,
        battle.roundsCompleted + 1,
        Math.random,
      );

      roundHistory.push(result);

      // Update battle state
      const newPlayerStats: CombatStats = {
        ...playerStats,
        strength: result.playerStrengthAfter,
        morale: result.playerMoraleAfter,
      };
      const newEnemyStats: CombatStats = {
        ...enemyStats,
        strength: result.enemyStrengthAfter,
        morale: result.enemyMoraleAfter,
      };

      const outcome = checkBattleEnd(newPlayerStats, newEnemyStats);
      const playerId = battle.ship.playerId;

      if (outcome === "ongoing") {
        // Battle continues
        await ctx.tx.battle.update({
          where: { id: battle.id },
          data: {
            playerStrength: result.playerStrengthAfter,
            playerMorale: result.playerMoraleAfter,
            enemyStrength: result.enemyStrengthAfter,
            enemyMorale: result.enemyMoraleAfter,
            roundsCompleted: { increment: 1 },
            nextRoundTick: ctx.tick + battle.roundInterval,
            roundHistory: JSON.stringify(roundHistory),
          },
        });

        emitBattleNotification(
          playerEvents,
          playerId,
          `Battle round ${battle.roundsCompleted + 1} at ${battle.system.name}: dealt ${result.playerDamageDealt} / took ${result.enemyDamageDealt} damage`,
          "battle_round",
          battle.ship.id,
          battle.ship.name,
          battle.systemId,
          battle.system.name,
        );
      } else {
        // Battle resolved
        await resolveBattle(
          ctx,
          battle,
          outcome,
          result,
          roundHistory,
          playerEvents,
        );
      }
    }

    // Persist notifications to DB
    await persistPlayerNotifications(ctx.tx, playerEvents, ctx.tick);

    return {
      globalEvents: activeBattles.length > 0
        ? { battlesUpdated: [{ count: activeBattles.length }] }
        : undefined,
      playerEvents: playerEvents.size > 0 ? playerEvents : undefined,
    };
  },
};

// ── Resolution helper ───────────────────────────────────────────

async function resolveBattle(
  ctx: Parameters<TickProcessor["process"]>[0],
  battle: {
    id: string;
    systemId: string;
    roundsCompleted: number;
    ship: {
      id: string;
      name: string;
      playerId: string;
      hullMax: number;
      hullCurrent: number;
      shieldMax: number;
      shieldCurrent: number;
    } | null;
    mission: { id: string; reward: number; type: string } | null;
    system: { name: string };
    playerStrength: number;
    dangerLevel: number | null;
    initialPlayerStrength: number | null;
  },
  outcome: BattleOutcome,
  finalRound: RoundResult,
  roundHistory: RoundResult[],
  playerEvents: Map<string, Partial<PlayerEventMap>>,
): Promise<void> {
  // Update battle status
  await ctx.tx.battle.update({
    where: { id: battle.id },
    data: {
      status: outcome,
      playerStrength: finalRound.playerStrengthAfter,
      playerMorale: finalRound.playerMoraleAfter,
      enemyStrength: finalRound.enemyStrengthAfter,
      enemyMorale: finalRound.enemyMoraleAfter,
      roundsCompleted: { increment: 1 },
      roundHistory: JSON.stringify(roundHistory),
      resolvedAtTick: ctx.tick,
    },
  });

  if (!battle.ship) return;

  const playerId = battle.ship.playerId;
  const initialStrength = battle.initialPlayerStrength ?? battle.playerStrength;

  // Apply damage to ship
  const damage = calculateBattleDamage(
    initialStrength,
    finalRound.playerStrengthAfter,
    {
      hullMax: battle.ship.hullMax,
      hullCurrent: battle.ship.hullCurrent,
      shieldMax: battle.ship.shieldMax,
      shieldCurrent: battle.ship.shieldCurrent,
      firepower: 0, // not needed for damage calc
      evasion: 0,
    },
  );

  if (damage.shieldDamage > 0 || damage.hullDamage > 0) {
    if (damage.disabled) {
      // Delete all cargo when disabled
      await ctx.tx.cargoItem.deleteMany({ where: { shipId: battle.ship.id } });
    }

    await ctx.tx.ship.update({
      where: { id: battle.ship.id },
      data: {
        shieldCurrent: Math.max(0, battle.ship.shieldCurrent - damage.shieldDamage),
        hullCurrent: Math.max(0, battle.ship.hullCurrent - damage.hullDamage),
        ...(damage.disabled ? { disabled: true } : {}),
      },
    });
  }

  // Handle mission resolution
  if (battle.mission) {
    if (outcome === "player_victory" || outcome === "enemy_retreat") {
      // Victory — credit reward
      const rewardMult = outcome === "player_victory" ? 1.0 : 0.6;
      const reward = Math.round(battle.mission.reward * rewardMult);

      await ctx.tx.mission.update({
        where: { id: battle.mission.id },
        data: {
          status: "completed",
          completedAtTick: ctx.tick,
          shipId: null,
        },
      });

      await ctx.tx.player.update({
        where: { id: playerId },
        data: { credits: { increment: reward } },
      });

      emitBattleNotification(
        playerEvents,
        playerId,
        `${outcome === "player_victory" ? "Victory" : "Enemy retreated"} at ${battle.system.name}! Earned ${reward} CR`,
        "battle_won",
        battle.ship.id,
        battle.ship.name,
        battle.systemId,
        battle.system.name,
      );
    } else {
      // Defeat or retreat — mission failed
      await ctx.tx.mission.update({
        where: { id: battle.mission.id },
        data: {
          status: "failed",
          shipId: null,
        },
      });

      emitBattleNotification(
        playerEvents,
        playerId,
        `${outcome === "player_defeat" ? "Defeated" : "Retreated"} at ${battle.system.name}. Mission failed.`,
        "battle_lost",
        battle.ship.id,
        battle.ship.name,
        battle.systemId,
        battle.system.name,
      );
    }
  }
}

function emitBattleNotification(
  playerEvents: Map<string, Partial<PlayerEventMap>>,
  playerId: string,
  message: string,
  type: NotificationType,
  shipId: string,
  shipName: string,
  systemId: string,
  systemName: string,
): void {
  const existing = playerEvents.get(playerId) ?? {};
  const notification: GameNotificationPayload = {
    message,
    type,
    refs: {
      ship: { id: shipId, label: shipName },
      system: { id: systemId, label: systemName },
    },
  };
  existing.gameNotifications = existing.gameNotifications
    ? [...existing.gameNotifications, notification]
    : [notification];
  playerEvents.set(playerId, existing);
}
