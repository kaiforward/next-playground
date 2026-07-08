import type { SystemControl } from "@/lib/world/types";

/**
 * A system participates in the economy (population, migration, market, logistics)
 * only once developed. Unclaimed and controlled systems are inert: their seeded
 * markets freeze and no population settles. This is the single predicate every
 * economy selection path gates through — the tick body, the economy adapter's
 * system selection, directed-build's build gate, and the system-detail services.
 */
export function isEconomicallyActive(control: SystemControl): boolean {
  return control === "developed";
}
