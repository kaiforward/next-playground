import { prisma } from "@/lib/prisma";
import { quoteTrade, curveForGood } from "@/lib/engine/market-pricing";
import { validateFleetTrade } from "@/lib/engine/trade";
import { getSpread, STOCK_MIN, STOCK_MAX } from "@/lib/constants/market-economy";
import { GOVERNMENT_TYPES } from "@/lib/constants/government";
import { GOOD_NAME_TO_KEY } from "@/lib/constants/goods";
import { toGovernmentType } from "@/lib/types/guards";
import { computeUpgradeBonuses } from "@/lib/engine/upgrades";
import { getInstalledModules } from "@/lib/utils/ship";
import { getReputationTier } from "@/lib/constants/reputation";
import { buildMarketEntry } from "./market-entry";
import { accrueTradeReputationInTx } from "./reputation";
import type { ShipTradeRequest } from "@/lib/types/api";
import type { MarketEntry } from "@/lib/types/game";

// ── Result types ────────────────────────────────────────────────

export interface ConvoyTradeResult {
  updatedMarket: MarketEntry;
}

type ConvoyTradeServiceResult =
  | { ok: true; data: ConvoyTradeResult }
  | { ok: false; error: string; status: number };

// ── Service ─────────────────────────────────────────────────────

/**
 * Execute a buy/sell trade for a convoy's combined cargo pool.
 *
 * - BUY: distributes goods across member ships sequentially (first with space gets goods)
 * - SELL: pulls goods from member ships sequentially (first with stock gets sold)
 *
 * TOCTOU-safe: all reads and writes inside a single transaction.
 */
export async function executeConvoyTrade(
  playerId: string,
  convoyId: string,
  request: ShipTradeRequest,
): Promise<ConvoyTradeServiceResult> {
  const { stationId, goodId, quantity, type } = request;

  if (!stationId || !goodId || !type) {
    return { ok: false, error: "Missing required fields.", status: 400 };
  }

  if (!Number.isInteger(quantity) || quantity <= 0) {
    return { ok: false, error: "Quantity must be a positive integer.", status: 400 };
  }

  // Pre-fetch convoy with members + cargo
  const convoy = await prisma.convoy.findUnique({
    where: { id: convoyId },
    select: {
      playerId: true,
      status: true,
      systemId: true,
      members: {
        include: {
          ship: {
            select: {
              id: true,
              playerId: true,
              cargoMax: true,
              cargo: true,
              upgradeSlots: {
                select: { slotType: true, moduleId: true, moduleTier: true },
              },
            },
          },
        },
      },
    },
  });

  if (!convoy || convoy.playerId !== playerId) {
    return { ok: false, error: "Convoy not found.", status: 404 };
  }

  if (convoy.status !== "docked") {
    return { ok: false, error: "Convoy must be docked to trade.", status: 400 };
  }

  const player = await prisma.player.findUnique({
    where: { id: playerId },
    select: { id: true, credits: true },
  });

  if (!player) {
    return { ok: false, error: "Player not found.", status: 404 };
  }

  // Verify station is at the convoy's system; resolve owning faction for
  // reputation gating + multipliers.
  const station = await prisma.station.findUnique({
    where: { systemId: convoy.systemId },
    include: {
      system: { select: { factionId: true, faction: { select: { governmentType: true } } } },
    },
  });
  if (!station || station.id !== stationId) {
    return { ok: false, error: "Station is not at the convoy's system.", status: 400 };
  }
  const factionId = station.system.factionId;
  const govDef = station.system.faction
    ? GOVERNMENT_TYPES[toGovernmentType(station.system.faction.governmentType)]
    : undefined;

  const marketEntry = await prisma.stationMarket.findUnique({
    where: { stationId_goodId: { stationId, goodId } },
    include: { good: true },
  });
  if (!marketEntry) {
    return { ok: false, error: "Good not available at this station.", status: 404 };
  }

  // Integrated-slippage quote priced off current stock + the government spread.
  const goodKey = GOOD_NAME_TO_KEY.get(marketEntry.good.name) ?? marketEntry.good.name;
  const curve = curveForGood(
    goodKey,
    marketEntry.good.basePrice,
    marketEntry.good.priceFloor,
    marketEntry.good.priceCeiling,
  );
  const spread = getSpread(govDef);
  const quote = quoteTrade(curve, marketEntry.stock, quantity, type, spread);

  // Reputation gating + multiplier. Mirrors single-ship trade.
  let totalPrice = quote.totalPrice;
  if (factionId) {
    const repRow = await prisma.playerFactionReputation.findUnique({
      where: { playerId_factionId: { playerId, factionId } },
      select: { score: true },
    });
    const tier = getReputationTier(repRow?.score ?? 0);
    if (tier.tradeDenied) {
      return {
        ok: false,
        error: "This faction refuses to trade with you (hostile standing).",
        status: 403,
      };
    }
    const mult = type === "buy" ? tier.buyMultiplier : tier.sellMultiplier;
    totalPrice = Math.round(totalPrice * mult);
  }
  const unitPrice = Math.round(totalPrice / quantity); // for trade history

  // Aggregate cargo across all member ships (accounting for upgrade bonuses)
  const ships = convoy.members.map((m) => m.ship);
  const combinedCargoMax = ships.reduce((s, ship) => {
    const bonuses = computeUpgradeBonuses(getInstalledModules(ship.upgradeSlots));
    return s + ship.cargoMax + bonuses.cargoBonus;
  }, 0);
  const combinedCargoUsed = ships.reduce(
    (s, ship) => s + ship.cargo.reduce((cs, c) => cs + c.quantity, 0),
    0,
  );
  const combinedGoodQuantity = ships.reduce(
    (s, ship) => s + (ship.cargo.find((c) => c.goodId === goodId)?.quantity ?? 0),
    0,
  );

  // Validate using the same pure trade engine
  const result = validateFleetTrade({
    type,
    quantity,
    totalPrice,
    playerCredits: player.credits,
    currentCargoUsed: combinedCargoUsed,
    cargoMax: combinedCargoMax,
    currentStock: marketEntry.stock,
    stockMin: STOCK_MIN,
    stockMax: STOCK_MAX,
    currentGoodQuantityInCargo: combinedGoodQuantity,
    shipStatus: "docked",
  });

  if (!result.ok) {
    return { ok: false, error: result.error, status: 400 };
  }

  const { delta } = result;

  // Hoist the current-tick read out of the transaction (see trade.ts for
  // rationale — tick is monotonic, slightly stale is safe).
  let currentTick = 0;
  if (factionId) {
    const world = await prisma.gameWorld.findUnique({
      where: { id: "world" },
      select: { currentTick: true },
    });
    currentTick = world?.currentTick ?? 0;
  }

  let updatedMarket;
  try {
    updatedMarket = await prisma.$transaction(async (tx) => {
      // Fresh hostile-gate check + per-tick capped reputation accrual.
      // Snapshot multiplier above used the pre-tx score; if a tick processor
      // flipped the player to hostile in between, abort here.
      if (factionId) {
        const { tradeDenied } = await accrueTradeReputationInTx(
          tx,
          player.id,
          factionId,
          currentTick,
        );
        if (tradeDenied) throw new Error("HOSTILE_STANDING");
      }

      // Re-read credits
      const freshPlayer = await tx.player.findUnique({
        where: { id: player.id },
        select: { credits: true },
      });
      if (!freshPlayer) throw new Error("PLAYER_NOT_FOUND");
      if (type === "buy" && freshPlayer.credits < delta.totalPrice) {
        throw new Error("INSUFFICIENT_CREDITS");
      }

      // Deduct/add credits
      await tx.player.update({
        where: { id: player.id },
        data: { credits: { increment: delta.creditsDelta } },
      });

      if (type === "buy") {
        // Distribute goods across member ships sequentially
        let remaining = quantity;
        for (const ship of ships) {
          if (remaining <= 0) break;
          const shipBonuses = computeUpgradeBonuses(getInstalledModules(ship.upgradeSlots));
          const effectiveCargoMax = ship.cargoMax + shipBonuses.cargoBonus;
          const shipCargoUsed = ship.cargo.reduce((s, c) => s + c.quantity, 0);
          const shipSpace = effectiveCargoMax - shipCargoUsed;
          if (shipSpace <= 0) continue;

          const toAdd = Math.min(remaining, shipSpace);
          remaining -= toAdd;

          const existingCargo = await tx.cargoItem.findFirst({
            where: { shipId: ship.id, goodId },
          });
          if (existingCargo) {
            await tx.cargoItem.update({
              where: { id: existingCargo.id },
              data: { quantity: { increment: toAdd } },
            });
          } else {
            await tx.cargoItem.create({
              data: { shipId: ship.id, goodId, quantity: toAdd },
            });
          }
        }
      } else {
        // Sell: pull goods from member ships sequentially
        let remaining = quantity;
        for (const ship of ships) {
          if (remaining <= 0) break;

          const existingCargo = await tx.cargoItem.findFirst({
            where: { shipId: ship.id, goodId },
          });
          if (!existingCargo || existingCargo.quantity <= 0) continue;

          const toSell = Math.min(remaining, existingCargo.quantity);
          remaining -= toSell;

          const newQty = existingCargo.quantity - toSell;
          if (newQty <= 0) {
            await tx.cargoItem.delete({ where: { id: existingCargo.id } });
          } else {
            await tx.cargoItem.update({
              where: { id: existingCargo.id },
              data: { quantity: newQty },
            });
          }
        }

        if (remaining > 0) {
          throw new Error("INSUFFICIENT_CARGO");
        }
      }

      // Update market stock (clamped)
      const freshMarket = await tx.stationMarket.findUnique({
        where: { id: marketEntry.id },
      });
      const nextStock = Math.max(
        STOCK_MIN,
        Math.min(STOCK_MAX, (freshMarket?.stock ?? 0) + delta.stockDelta),
      );
      const market = await tx.stationMarket.update({
        where: { id: marketEntry.id },
        data: { stock: nextStock },
        include: { good: true },
      });

      // Trade history
      await tx.tradeHistory.create({
        data: { stationId, goodId, price: unitPrice, quantity, type, playerId: player.id },
      });

      // Increment trade volume accumulator on the system for prosperity computation
      await tx.starSystem.update({
        where: { id: convoy.systemId },
        data: { tradeVolumeAccum: { increment: quantity } },
      });

      return market;
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "HOSTILE_STANDING") {
        return {
          ok: false,
          error: "This faction refuses to trade with you (hostile standing).",
          status: 403,
        };
      }
      if (error.message === "INSUFFICIENT_CREDITS") {
        return { ok: false, error: "Not enough credits. State may have changed concurrently.", status: 409 };
      }
      if (error.message === "INSUFFICIENT_CARGO") {
        return { ok: false, error: "Not enough cargo. State may have changed concurrently.", status: 409 };
      }
    }
    throw error;
  }

  return {
    ok: true,
    data: {
      updatedMarket: buildMarketEntry(
        updatedMarket.goodId,
        updatedMarket.good,
        updatedMarket.stock,
        govDef,
      ),
    },
  };
}
