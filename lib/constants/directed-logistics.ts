import { scaleValue } from "@/lib/constants/economy-scale";

/**
 * Directed-logistics tuning. First-draft, simulator-calibrated; only relative shape matters.
 * See docs/active/gameplay/economy-autonomic-agency.md.
 */
export const DIRECTED_LOGISTICS = {
  /** Work-budget a system contributes per cycle = population × this. Free in v1 (no treasury). */
  GENERATION_PER_POP: scaleValue(0.5),
  /** A good is a surplus when stock ≥ targetStock × this (held above its cycles-of-supply anchor). Margin > 1 leaves a deliberate residual (negative space). */
  SURPLUS_MARGIN: 1.4,
  /**
   * Cycles of its own demand a structural exporter keeps on hand before shipping the rest — a
   * warehousing rule, deliberately NOT a fraction of the pricing anchor. Denominating it against
   * `TARGET_COVER` (40 cycles, a price-curve reference) put the threshold at 30 cycles of cover, which
   * a producer built to demand + PROVISION_MARGIN can only just reach: producers pinned exactly at the
   * line and shipped only their thin margin, so goods nobody could make locally — medicine, consumer
   * goods, electronics — reached almost nobody. Stated in cycles it is also immune to `anchor_shift`
   * events, which move the price anchor and have no business moving warehouse policy.
   * Well above RATION_COVER, so exporting never rations the exporter. This is distinct from the
   * initial market seed reserve.
   */
  EXPORT_RESERVE_COVER: 10,
  /** A good is a deficit when stock < targetStock × this (below its cycles-of-supply anchor). < 1 leaves a comfortable dead-band above it (with SURPLUS_MARGIN) — the residual / negative space. */
  DEFICIT_FRACTION: 0.8,
  /** Max hops a logistics transfer may span (beyond this, route cost is treated as unreachable). */
  MAX_HOPS: 4,
  /** Per-unit route cost = quantity × (hops × HOP_WEIGHT + totalFuelCost × FUEL_WEIGHT). */
  HOP_WEIGHT: 1.0,
  FUEL_WEIGHT: 0.1,
} as const;
