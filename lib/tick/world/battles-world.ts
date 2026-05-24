/**
 * BattlesWorld — data interface for the battles processor.
 *
 * No sim counterpart — combat does not run in the simulator. See
 * `docs/design/active/processor-architecture.md` for the broader pattern.
 */

import type { BattleOutcome, RoundResult } from "@/lib/engine/combat";
import type { PlayerEventMap } from "@/lib/tick/types";

/** Ship participating in a battle. Null in `ActiveBattleView` if the ship has disappeared. */
export interface BattleShipView {
  id: string;
  name: string;
  playerId: string;
  hullMax: number;
  hullCurrent: number;
  shieldMax: number;
  shieldCurrent: number;
  firepower: number;
  evasion: number;
}

/** Mission tied to a battle (bounty missions). */
export interface BattleMissionView {
  id: string;
  reward: number;
  type: string;
}

/** Active battle with all data the processor body needs. */
export interface ActiveBattleView {
  id: string;
  systemId: string;
  systemName: string;
  playerStrength: number;
  playerMorale: number;
  enemyStrength: number;
  enemyMorale: number;
  enemyTier: string;
  dangerLevel: number | null;
  initialPlayerStrength: number | null;
  roundsCompleted: number;
  roundInterval: number;
  /** Round history serialized as JSON — adapter writes the same shape back. */
  roundHistory: RoundResult[];
  ship: BattleShipView | null;
  mission: BattleMissionView | null;
}

/** Persist an ongoing battle's next-round state. */
export interface OngoingBattleUpdate {
  battleId: string;
  playerStrength: number;
  playerMorale: number;
  enemyStrength: number;
  enemyMorale: number;
  nextRoundTick: number;
  roundHistory: RoundResult[];
}

/** Persist a battle's final state. */
export interface BattleResolution {
  battleId: string;
  outcome: BattleOutcome;
  playerStrength: number;
  playerMorale: number;
  enemyStrength: number;
  enemyMorale: number;
  roundHistory: RoundResult[];
  resolvedAtTick: number;
}

/** Apply post-battle ship damage. Cargo is cleared when `disabled` is true. */
export interface ShipDamageApply {
  shipId: string;
  shieldCurrent: number;
  hullCurrent: number;
  disabled: boolean;
}

export interface BattlesWorld {
  /** Active battles whose next round is due. */
  getActiveBattlesDue(currentTick: number): Promise<ActiveBattleView[]>;

  /**
   * Mark a battle as `player_defeat` when its ship has disappeared mid-battle.
   * Does not touch a linked mission — the processor calls `failMission` next.
   */
  markBattleDefeated(battleId: string, currentTick: number): Promise<void>;

  /** Update a still-ongoing battle with new round state. */
  updateOngoingBattle(update: OngoingBattleUpdate): Promise<void>;

  /** Persist a battle's terminal state (status + final round). */
  resolveBattleRecord(resolution: BattleResolution): Promise<void>;

  /**
   * Apply ship damage. When `disabled` is true the adapter also deletes
   * the ship's cargo.
   */
  applyShipDamage(damage: ShipDamageApply): Promise<void>;

  /** Mark mission completed, free its ship, and credit reward to the player. */
  completeMissionAndReward(
    missionId: string,
    playerId: string,
    reward: number,
    currentTick: number,
  ): Promise<void>;

  /** Mark a mission failed and free its ship. */
  failMission(missionId: string): Promise<void>;

  /** Persist accumulated player notifications. */
  persistNotifications(
    events: Map<string, Partial<PlayerEventMap>>,
    tick: number,
  ): Promise<void>;
}
