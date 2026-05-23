import type {
  TickContext,
  TickProcessor,
  TickProcessorResult,
  PlayerEventMap,
} from "../types";
import { addPlayerNotification } from "../helpers";
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
import { PrismaBattlesWorld } from "@/lib/tick/adapters/prisma/battles";
import type {
  ActiveBattleView,
  BattlesWorld,
} from "@/lib/tick/world/battles-world";

export interface BattlesProcessorParams {
  rng: () => number;
}

/**
 * Pure processor body. Depends only on `BattlesWorld` + an injected RNG.
 * Resolves one round per active battle whose `nextRoundTick` has come due.
 */
export async function runBattlesProcessor(
  world: BattlesWorld,
  ctx: TickContext,
  params: BattlesProcessorParams,
): Promise<TickProcessorResult> {
  const { rng } = params;
  const activeBattles = await world.getActiveBattlesDue(ctx.tick);

  if (activeBattles.length === 0) return {};

  const playerEvents = new Map<string, Partial<PlayerEventMap>>();

  for (const battle of activeBattles) {
    if (!battle.ship) {
      await world.markBattleDefeated(battle.id, ctx.tick);
      if (battle.mission) {
        await world.failMission(battle.mission.id);
      }
      continue;
    }

    const { FIREPOWER_TO_DAMAGE, EVASION_K, MAX_EVASION_REDUCTION } =
      COMBAT_CONSTANTS;

    const playerDamagePerRound = battle.ship.firepower * FIREPOWER_TO_DAMAGE;
    const rawReduction =
      battle.ship.evasion / (battle.ship.evasion + EVASION_K);
    const playerDamageReduction = Math.min(rawReduction, MAX_EVASION_REDUCTION);

    const playerStats: CombatStats = {
      strength: battle.playerStrength,
      morale: battle.playerMorale,
      damagePerRound: playerDamagePerRound,
      damageReduction: playerDamageReduction,
    };

    const tierDef = isEnemyTier(battle.enemyTier)
      ? ENEMY_TIERS[battle.enemyTier]
      : null;
    const dangerScale =
      battle.dangerLevel != null ? 0.6 + battle.dangerLevel * 0.8 : 0.8;

    const enemyStats: CombatStats = {
      strength: battle.enemyStrength,
      morale: battle.enemyMorale,
      damagePerRound: tierDef
        ? Math.round(tierDef.baseDamagePerRound * dangerScale * 10) / 10
        : 5,
      damageReduction: tierDef ? tierDef.baseDamageReduction : 0.05,
    };

    const result = resolveRound(
      playerStats,
      enemyStats,
      battle.roundsCompleted + 1,
      rng,
    );

    const roundHistory = [...battle.roundHistory, result];

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
      await world.updateOngoingBattle({
        battleId: battle.id,
        playerStrength: result.playerStrengthAfter,
        playerMorale: result.playerMoraleAfter,
        enemyStrength: result.enemyStrengthAfter,
        enemyMorale: result.enemyMoraleAfter,
        nextRoundTick: ctx.tick + battle.roundInterval,
        roundHistory,
      });

      emitBattleNotification(
        playerEvents,
        playerId,
        `Battle round ${battle.roundsCompleted + 1} at ${battle.systemName}: dealt ${result.playerDamageDealt} / took ${result.enemyDamageDealt} damage`,
        "battle_round",
        battle.ship.id,
        battle.ship.name,
        battle.systemId,
        battle.systemName,
      );
    } else {
      await resolveBattle(
        world,
        ctx,
        battle,
        outcome,
        result,
        roundHistory,
        playerEvents,
      );
    }
  }

  await world.persistNotifications(playerEvents, ctx.tick);

  return {
    globalEvents: { battlesUpdated: [{ count: activeBattles.length }] },
    playerEvents: playerEvents.size > 0 ? playerEvents : undefined,
  };
}

// ── Resolution helper ───────────────────────────────────────────

async function resolveBattle(
  world: BattlesWorld,
  ctx: TickContext,
  battle: ActiveBattleView,
  outcome: BattleOutcome,
  finalRound: RoundResult,
  roundHistory: RoundResult[],
  playerEvents: Map<string, Partial<PlayerEventMap>>,
): Promise<void> {
  await world.resolveBattleRecord({
    battleId: battle.id,
    outcome,
    playerStrength: finalRound.playerStrengthAfter,
    playerMorale: finalRound.playerMoraleAfter,
    enemyStrength: finalRound.enemyStrengthAfter,
    enemyMorale: finalRound.enemyMoraleAfter,
    roundHistory,
    resolvedAtTick: ctx.tick,
  });

  if (!battle.ship) return;

  const playerId = battle.ship.playerId;
  const initialStrength =
    battle.initialPlayerStrength ?? battle.playerStrength;

  const damage = calculateBattleDamage(
    initialStrength,
    finalRound.playerStrengthAfter,
    {
      hullMax: battle.ship.hullMax,
      hullCurrent: battle.ship.hullCurrent,
      shieldMax: battle.ship.shieldMax,
      shieldCurrent: battle.ship.shieldCurrent,
      firepower: 0,
      evasion: 0,
    },
  );

  if (damage.shieldDamage > 0 || damage.hullDamage > 0) {
    await world.applyShipDamage({
      shipId: battle.ship.id,
      shieldCurrent: Math.max(
        0,
        battle.ship.shieldCurrent - damage.shieldDamage,
      ),
      hullCurrent: Math.max(0, battle.ship.hullCurrent - damage.hullDamage),
      disabled: damage.disabled,
    });
  }

  if (battle.mission) {
    if (outcome === "player_victory" || outcome === "enemy_retreat") {
      const rewardMult = outcome === "player_victory" ? 1.0 : 0.6;
      const reward = Math.round(battle.mission.reward * rewardMult);

      await world.completeMissionAndReward(
        battle.mission.id,
        playerId,
        reward,
        ctx.tick,
      );

      emitBattleNotification(
        playerEvents,
        playerId,
        `${outcome === "player_victory" ? "Victory" : "Enemy retreated"} at ${battle.systemName}! Earned ${reward} CR`,
        "battle_won",
        battle.ship.id,
        battle.ship.name,
        battle.systemId,
        battle.systemName,
      );
    } else {
      await world.failMission(battle.mission.id);

      emitBattleNotification(
        playerEvents,
        playerId,
        `${outcome === "player_defeat" ? "Defeated" : "Retreated"} at ${battle.systemName}. Mission failed.`,
        "battle_lost",
        battle.ship.id,
        battle.ship.name,
        battle.systemId,
        battle.systemName,
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
  addPlayerNotification(playerEvents, playerId, {
    message,
    type,
    refs: {
      ship: { id: shipId, label: shipName },
      system: { id: systemId, label: systemName },
    },
  });
}

// ── Live-game wiring ──────────────────────────────────────────────

export const battlesProcessor: TickProcessor = {
  name: "battles",
  frequency: 1,
  dependsOn: ["ship-arrivals"],

  async process(ctx): Promise<TickProcessorResult> {
    const world = new PrismaBattlesWorld(ctx.tx);
    return runBattlesProcessor(world, ctx, { rng: Math.random });
  },
};
