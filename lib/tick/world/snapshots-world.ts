/**
 * SnapshotsWorld — data interface for the price-snapshots processor.
 *
 * # The processor-world pattern
 *
 * Each processor declares its data needs as a typed interface in this directory.
 * The processor body depends only on the interface, never on Prisma or SimWorld
 * types directly. Two adapters implement each interface:
 *
 *   - `lib/tick/adapters/prisma/`  — live game (TxClient-backed)
 *   - `lib/tick/adapters/memory/`  — simulator / unit tests (in-memory)
 *
 * Same processor body runs against both. New features are written once.
 *
 * # Interface shape principles
 *
 *   - Domain-shaped, not data-shaped: `getMarkets()`, not `query(sql)`.
 *   - Per-processor, not shared: no god-interface across systems.
 *   - Reads return plain views (`MarketView`), not Prisma models. Decouples the
 *     processor from schema changes.
 *   - Mutations are explicit method calls. No exposing transactions.
 *
 * See `docs/design/active/processor-architecture.md` for the full rationale.
 */

import type { PriceHistoryEntry } from "@/lib/engine/snapshot";

/** Flat market row — one per (system, good) — needed to compute prices. */
export interface MarketView {
  systemId: string;
  /** Canonical good key (resolved by the adapter) so the price curve anchors correctly. */
  goodId: string;
  stock: number;
  anchorMult: number;
  /** Days-of-supply pricing denominator (perCapitaNeed × population, floored). */
  demandRate: number;
  basePrice: number;
  priceFloor: number;
  priceCeiling: number;
}

/** Price history for a single system. Entries are sorted oldest → newest. */
export interface PriceHistoryView {
  systemId: string;
  entries: PriceHistoryEntry[];
}

export interface SnapshotsWorld {
  /** All market rows across all stations. Used to compute the current snapshot. */
  getMarkets(): Promise<MarketView[]>;

  /** One row per system that has a PriceHistory record. */
  getPriceHistories(): Promise<PriceHistoryView[]>;

  /**
   * Replace the entries array for each provided system. Rows for systems
   * without an existing history record are ignored (history rows are
   * pre-created during seed; the processor never creates them).
   */
  writePriceHistories(views: PriceHistoryView[]): Promise<void>;
}
