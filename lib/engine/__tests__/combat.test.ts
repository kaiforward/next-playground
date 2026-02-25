import { describe, it, expect } from "vitest";
import {
  derivePlayerCombatStats,
  deriveEnemyCombatStats,
  resolveRound,
  checkBattleEnd,
  calculateBattleDamage,
  type ShipCombatInput,
  type CombatStats,
} from "../combat";
import { COMBAT_CONSTANTS } from "@/lib/constants/combat";

// ── Helpers ──────────────────────────────────────────────────────

function makeShip(overrides: Partial<ShipCombatInput> = {}): ShipCombatInput {
  return {
    hullMax: 70,
    hullCurrent: 70,
    shieldMax: 30,
    shieldCurrent: 30,
    firepower: 12,
    evasion: 5,
    ...overrides,
  };
}

/** Deterministic RNG that returns values from a sequence. */
function seededRng(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

// ── derivePlayerCombatStats ──────────────────────────────────────

describe("derivePlayerCombatStats", () => {
  it("calculates strength as hull + shield", () => {
    const stats = derivePlayerCombatStats(makeShip());
    expect(stats.strength).toBe(100); // 70 + 30
  });

  it("calculates damage from firepower", () => {
    const stats = derivePlayerCombatStats(makeShip({ firepower: 10 }));
    expect(stats.damagePerRound).toBe(15); // 10 * 1.5
  });

  it("calculates evasion-based damage reduction with diminishing returns", () => {
    const stats = derivePlayerCombatStats(makeShip({ evasion: 5 }));
    // 5 / (5 + 20) = 0.2
    expect(stats.damageReduction).toBe(0.2);
  });

  it("caps damage reduction at MAX_EVASION_REDUCTION", () => {
    const stats = derivePlayerCombatStats(makeShip({ evasion: 100 }));
    expect(stats.damageReduction).toBe(COMBAT_CONSTANTS.MAX_EVASION_REDUCTION);
  });

  it("includes health bonus in morale", () => {
    const fullHealth = derivePlayerCombatStats(makeShip({ hullMax: 100, hullCurrent: 100 }));
    const halfHealth = derivePlayerCombatStats(makeShip({ hullMax: 100, hullCurrent: 50 }));
    // Full: 85 + 15 = 100, Half: 85 + 7.5 = 92.5
    expect(fullHealth.morale).toBe(100);
    expect(halfHealth.morale).toBe(92.5);
  });

  it("handles zero hull max gracefully", () => {
    const stats = derivePlayerCombatStats(makeShip({ hullMax: 0, hullCurrent: 0, shieldCurrent: 10 }));
    expect(stats.morale).toBe(COMBAT_CONSTANTS.MORALE_START_BASE);
    expect(stats.strength).toBe(10);
  });
});

// ── deriveEnemyCombatStats ───────────────────────────────────────

describe("deriveEnemyCombatStats", () => {
  it("scales weak tier with danger", () => {
    const stats = deriveEnemyCombatStats("weak", 0.15);
    // dangerScale = 0.6 + 0.15 * 0.8 = 0.72
    expect(stats.strength).toBe(Math.round(40 * 0.72));
    expect(stats.morale).toBe(60);
  });

  it("scales moderate tier with danger", () => {
    const stats = deriveEnemyCombatStats("moderate", 0.3);
    // dangerScale = 0.6 + 0.3 * 0.8 = 0.84
    expect(stats.strength).toBe(Math.round(70 * 0.84));
  });

  it("scales strong tier with high danger", () => {
    const stats = deriveEnemyCombatStats("strong", 0.5);
    // dangerScale = 0.6 + 0.5 * 0.8 = 1.0
    expect(stats.strength).toBe(110);
    expect(stats.morale).toBe(80);
  });
});

// ── resolveRound ────────────────────────────────────────────────

describe("resolveRound", () => {
  it("both sides deal damage simultaneously", () => {
    const player: CombatStats = { strength: 100, morale: 90, damagePerRound: 15, damageReduction: 0.2 };
    const enemy: CombatStats = { strength: 60, morale: 70, damagePerRound: 8, damageReduction: 0.1 };

    // rng returns 0.5 twice (no variance)
    const result = resolveRound(player, enemy, 1, seededRng([0.5, 0.5]));

    // Player deals: 15 * (1 - 0.1) = 13.5 → round to 14
    expect(result.playerDamageDealt).toBe(14);
    // Enemy deals: 8 * (1 - 0.2) = 6.4 → round to 6
    expect(result.enemyDamageDealt).toBe(6);
    expect(result.playerStrengthAfter).toBe(94);
    expect(result.enemyStrengthAfter).toBe(46);
  });

  it("minimum 1 damage per side", () => {
    const player: CombatStats = { strength: 100, morale: 90, damagePerRound: 0.5, damageReduction: 0 };
    const enemy: CombatStats = { strength: 60, morale: 70, damagePerRound: 0.5, damageReduction: 0 };

    const result = resolveRound(player, enemy, 1, seededRng([0.5, 0.5]));
    expect(result.playerDamageDealt).toBeGreaterThanOrEqual(1);
    expect(result.enemyDamageDealt).toBeGreaterThanOrEqual(1);
  });

  it("lopsided round causes large morale swing", () => {
    // Player does huge damage, enemy does little
    const player: CombatStats = { strength: 100, morale: 85, damagePerRound: 20, damageReduction: 0.3 };
    const enemy: CombatStats = { strength: 60, morale: 70, damagePerRound: 3, damageReduction: 0 };

    const result = resolveRound(player, enemy, 1, seededRng([0.5, 0.5]));

    // Player dealt 20, enemy dealt 2 — ratio > 2:1
    expect(result.playerMoraleAfter).toBeGreaterThan(85);
    expect(result.enemyMoraleAfter).toBeLessThan(70);
  });

  it("clamps morale to [0, 100]", () => {
    const player: CombatStats = { strength: 100, morale: 98, damagePerRound: 30, damageReduction: 0 };
    const enemy: CombatStats = { strength: 60, morale: 5, damagePerRound: 1, damageReduction: 0 };

    const result = resolveRound(player, enemy, 1, seededRng([0.5, 0.5]));

    expect(result.playerMoraleAfter).toBeLessThanOrEqual(100);
    expect(result.enemyMoraleAfter).toBeGreaterThanOrEqual(0);
  });

  it("records the round number", () => {
    const player: CombatStats = { strength: 100, morale: 85, damagePerRound: 10, damageReduction: 0 };
    const enemy: CombatStats = { strength: 50, morale: 60, damagePerRound: 5, damageReduction: 0 };

    const result = resolveRound(player, enemy, 5, seededRng([0.5, 0.5]));
    expect(result.round).toBe(5);
  });
});

// ── checkBattleEnd ──────────────────────────────────────────────

describe("checkBattleEnd", () => {
  it("returns ongoing when both sides are healthy", () => {
    const player: CombatStats = { strength: 80, morale: 80, damagePerRound: 10, damageReduction: 0 };
    const enemy: CombatStats = { strength: 50, morale: 60, damagePerRound: 5, damageReduction: 0 };
    expect(checkBattleEnd(player, enemy)).toBe("ongoing");
  });

  it("returns player_victory when enemy strength ≤ 0", () => {
    const player: CombatStats = { strength: 30, morale: 50, damagePerRound: 10, damageReduction: 0 };
    const enemy: CombatStats = { strength: 0, morale: 60, damagePerRound: 5, damageReduction: 0 };
    expect(checkBattleEnd(player, enemy)).toBe("player_victory");
  });

  it("returns player_defeat when player strength ≤ 0", () => {
    const player: CombatStats = { strength: 0, morale: 50, damagePerRound: 10, damageReduction: 0 };
    const enemy: CombatStats = { strength: 30, morale: 60, damagePerRound: 5, damageReduction: 0 };
    expect(checkBattleEnd(player, enemy)).toBe("player_defeat");
  });

  it("returns player_defeat when both destroyed simultaneously", () => {
    const player: CombatStats = { strength: 0, morale: 50, damagePerRound: 10, damageReduction: 0 };
    const enemy: CombatStats = { strength: 0, morale: 50, damagePerRound: 5, damageReduction: 0 };
    expect(checkBattleEnd(player, enemy)).toBe("player_defeat");
  });

  it("returns enemy_retreat when enemy morale breaks", () => {
    const player: CombatStats = { strength: 50, morale: 60, damagePerRound: 10, damageReduction: 0 };
    const enemy: CombatStats = { strength: 30, morale: 10, damagePerRound: 5, damageReduction: 0 };
    expect(checkBattleEnd(player, enemy)).toBe("enemy_retreat");
  });

  it("returns player_retreat when player morale breaks", () => {
    const player: CombatStats = { strength: 50, morale: 10, damagePerRound: 10, damageReduction: 0 };
    const enemy: CombatStats = { strength: 30, morale: 60, damagePerRound: 5, damageReduction: 0 };
    expect(checkBattleEnd(player, enemy)).toBe("player_retreat");
  });

  it("handles mutual morale break — higher morale stays", () => {
    const player: CombatStats = { strength: 50, morale: 14, damagePerRound: 10, damageReduction: 0 };
    const enemy: CombatStats = { strength: 30, morale: 12, damagePerRound: 5, damageReduction: 0 };
    // Player morale 14 >= enemy morale 12 → enemy retreats
    expect(checkBattleEnd(player, enemy)).toBe("enemy_retreat");
  });

  it("strength check takes priority over morale", () => {
    const player: CombatStats = { strength: 50, morale: 5, damagePerRound: 10, damageReduction: 0 };
    const enemy: CombatStats = { strength: 0, morale: 80, damagePerRound: 5, damageReduction: 0 };
    // Enemy destroyed even though player morale is low
    expect(checkBattleEnd(player, enemy)).toBe("player_victory");
  });
});

// ── calculateBattleDamage ───────────────────────────────────────

describe("calculateBattleDamage", () => {
  it("returns no damage when strength is unchanged", () => {
    const ship = makeShip();
    const result = calculateBattleDamage(100, 100, ship);
    expect(result).toEqual({ shieldDamage: 0, hullDamage: 0, disabled: false });
  });

  it("shields absorb damage first", () => {
    const ship = makeShip({ shieldCurrent: 30, hullCurrent: 70 });
    // Lost 20 strength points
    const result = calculateBattleDamage(100, 80, ship);
    expect(result.shieldDamage).toBe(20);
    expect(result.hullDamage).toBe(0);
    expect(result.disabled).toBe(false);
  });

  it("hull takes remaining damage after shields depleted", () => {
    const ship = makeShip({ shieldCurrent: 10, hullCurrent: 70 });
    // Lost 30 strength points
    const result = calculateBattleDamage(80, 50, ship);
    expect(result.shieldDamage).toBe(10);
    expect(result.hullDamage).toBe(20);
    expect(result.disabled).toBe(false);
  });

  it("ship is disabled when hull reaches 0", () => {
    const ship = makeShip({ shieldCurrent: 5, hullCurrent: 15 });
    // Lost 20 strength points
    const result = calculateBattleDamage(20, 0, ship);
    expect(result.shieldDamage).toBe(5);
    expect(result.hullDamage).toBe(15);
    expect(result.disabled).toBe(true);
  });

  it("handles final strength higher than initial (no negative damage)", () => {
    const ship = makeShip();
    const result = calculateBattleDamage(80, 90, ship);
    expect(result).toEqual({ shieldDamage: 0, hullDamage: 0, disabled: false });
  });
});

// ── Integration: multi-round battle ─────────────────────────────

describe("multi-round battle integration", () => {
  it("a strong ship defeats weak pirates within a reasonable number of rounds", () => {
    let player = derivePlayerCombatStats(makeShip({ firepower: 12, evasion: 5 }));
    let enemy = deriveEnemyCombatStats("weak", 0.2);

    const rng = seededRng([0.5, 0.5]); // no variance
    let rounds = 0;

    while (rounds < 50) {
      const result = resolveRound(player, enemy, rounds + 1, rng);
      player = { ...player, strength: result.playerStrengthAfter, morale: result.playerMoraleAfter };
      enemy = { ...enemy, strength: result.enemyStrengthAfter, morale: result.enemyMoraleAfter };

      const outcome = checkBattleEnd(player, enemy);
      if (outcome !== "ongoing") {
        expect(outcome).toBe("player_victory");
        break;
      }
      rounds++;
    }
    expect(rounds).toBeLessThan(50);
  });

  it("a weak ship may retreat against strong pirates", () => {
    let player = derivePlayerCombatStats(makeShip({
      firepower: 4, hullMax: 30, hullCurrent: 30, shieldMax: 10, shieldCurrent: 10, evasion: 3,
    }));
    let enemy = deriveEnemyCombatStats("strong", 0.5);

    const rng = seededRng([0.5, 0.5]);
    let outcome: string = "ongoing";
    let rounds = 0;

    while (rounds < 50) {
      const result = resolveRound(player, enemy, rounds + 1, rng);
      player = { ...player, strength: result.playerStrengthAfter, morale: result.playerMoraleAfter };
      enemy = { ...enemy, strength: result.enemyStrengthAfter, morale: result.enemyMoraleAfter };

      outcome = checkBattleEnd(player, enemy);
      if (outcome !== "ongoing") break;
      rounds++;
    }

    // Weak ship should either retreat or be defeated
    expect(["player_defeat", "player_retreat"]).toContain(outcome);
  });
});
