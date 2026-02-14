/**
 * Strategy registry — maps strategy names to factory functions.
 */

import type { RNG } from "@/lib/engine/universe-gen";
import type { TradeStrategy } from "./types";
import { createRandomStrategy } from "./random";
import { createNearestStrategy } from "./nearest";
import { createGreedyStrategy } from "./greedy";
import { createOptimalStrategy } from "./optimal";

export type StrategyFactory = (rng: RNG) => TradeStrategy;

export const STRATEGIES: Record<string, StrategyFactory> = {
  random: (rng) => createRandomStrategy(rng),
  nearest: () => createNearestStrategy(),
  greedy: () => createGreedyStrategy(),
  optimal: () => createOptimalStrategy(),
};

export const STRATEGY_NAMES = Object.keys(STRATEGIES);

export type { TradeStrategy, TradeDecision } from "./types";
