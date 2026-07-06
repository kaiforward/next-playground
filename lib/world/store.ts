import { ServiceError } from "@/lib/services/errors";
import type { World } from "./types";

interface WorldStore { world: World | null; version: number }

declare global {
  // eslint-disable-next-line no-var
  var __world: WorldStore | undefined;
}

const globalStore: { __world?: WorldStore } = globalThis;
const store: WorldStore = (globalStore.__world ??= { world: null, version: 0 });

export function hasWorld(): boolean { return store.world !== null; }
export function getWorld(): World {
  if (!store.world) throw new ServiceError("No world loaded", 409);
  return store.world;
}
export function setWorld(world: World): void { store.world = world; store.version += 1; }
export function getWorldVersion(): number { return store.version; }
export function clearWorld(): void { store.world = null; store.version += 1; }
