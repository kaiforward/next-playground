import { generateWorld } from "@/lib/world/gen";
import { setWorld } from "@/lib/world/store";
import { tickLoop, type Speed } from "@/lib/world/tick-loop";
import type { WorldMeta } from "@/lib/world/types";

/**
 * Create a fresh world and swap it into the store. Pauses the tick loop first
 * so the swap can't race a tick mid-generation; the player resumes pacing
 * explicitly from the UI.
 */
export function newGame(input: { systemCount: number; seed?: number }): WorldMeta {
  // The only permissible Math.random — a default seed picked outside the
  // deterministic tick path.
  const seed = input.seed ?? Math.floor(Math.random() * 2_000_000_000);
  tickLoop.setSpeed("paused");
  const world = generateWorld({ systemCount: input.systemCount, seed });
  setWorld(world);
  return world.meta;
}

/** Set the tick-loop speed and report the value actually applied. */
export function setGameSpeed(speed: Speed): { speed: Speed } {
  tickLoop.setSpeed(speed);
  return { speed: tickLoop.getSpeed() };
}
