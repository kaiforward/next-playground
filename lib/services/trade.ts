import { prisma } from "@/lib/prisma";
import { serializeShip } from "@/lib/auth/serialize";
import { quoteTrade, curveForGood } from "@/lib/engine/market-pricing";
import { validateFleetTrade } from "@/lib/engine/trade";
import { getSpread, STOCK_MIN, STOCK_MAX } from "@/lib/constants/market-economy";
import { GOVERNMENT_TYPES } from "@/lib/constants/government";
import { GOOD_NAME_TO_KEY } from "@/lib/constants/goods";
import { toShipStatus, toGovernmentType } from "@/lib/types/guards";
import { getReputationTier } from "@/lib/constants/reputation";
import { buildMarketEntry } from "./market-entry";
import { accrueTradeReputationInTx } from "./reputation";
import { SHIP_INCLUDE } from "./fleet";
import type { ShipTradeRequest, ShipTradeResult } from "@/lib/types/api";

type TradeResult =
  | { ok: true; data: ShipTradeResult }
  | { ok: false; error: string; status: number };

/**
 * Execute a buy/sell trade for a specific ship.
 * Preserves full TOCTOU transaction guard from the original route handler.
 */
export async function executeTrade(
  playerId: string,
  shipId: string,
  request: ShipTradeRequest,
): Promise<TradeResult> {
  const { stationId, goodId, quantity, type } = request;

  if (!stationId || !goodId || !type) {
    return { ok: false, error: "Missing required fields: stationId, goodId, quantity, type.", status: 400 };
  }

  if (!Number.isInteger(quantity) || quantity <= 0) {
    return { ok: false, error: "Quantity must be a positive integer.", status: 400 };
  }

  // Fetch player (need credits for validation) + ship by ID, verify ownership
  const player = await prisma.player.findUnique({
    where: { id: playerId },
    select: { id: true, credits: true },
  });

  if (!player) {
    return { ok: false, error: "Player not found.", status: 404 };
  }

  const ship = await prisma.ship.findUnique({
    where: { id: shipId },
    select: {
      id: true,
      playerId: true,
      status: true,
      systemId: true,
      cargoMax: true,
      cargo: true,
      convoyMember: { select: { convoyId: true } },
    },
  });

  if (!ship || ship.playerId !== playerId) {
    return { ok: false, error: "Ship not found or does not belong to you.", status: 404 };
  }

  if (ship.convoyMember) {
    return { ok: false, error: "This ship is in a convoy. Trade via the convoy instead.", status: 400 };
  }

  // Verify station is in the ship's current system; resolve owning faction
  // at the same time so reputation gating + multipliers can be applied below.
  const station = await prisma.station.findUnique({
    where: { systemId: ship.systemId },
    include: {
      system: { select: { factionId: true, faction: { select: { governmentType: true } } } },
    },
  });
  if (!station || station.id !== stationId) {
    return { ok: false, error: "Station is not in the ship's current system.", status: 400 };
  }
  const factionId = station.system.factionId;
  const govDef = station.system.faction
    ? GOVERNMENT_TYPES[toGovernmentType(station.system.faction.governmentType)]
    : undefined;

  // Look up the market entry
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
    marketEntry.anchorMult,
  );
  const spread = getSpread(govDef);
  const quote = quoteTrade(curve, marketEntry.stock, quantity, type, spread);

  // Reputation gating + multiplier (stacks on the quote, as before). Systems
  // without a faction (transient mid-cutover state) trade at neutral; hostile
  // standing blocks the trade.
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

  const currentCargoUsed = ship.cargo.reduce((sum, c) => sum + c.quantity, 0);
  const existingCargo = ship.cargo.find((c) => c.goodId === goodId);
  const currentGoodQuantityInCargo = existingCargo?.quantity ?? 0;

  const result = validateFleetTrade({
    type,
    quantity,
    totalPrice,
    playerCredits: player.credits,
    currentCargoUsed,
    cargoMax: ship.cargoMax,
    currentStock: marketEntry.stock,
    stockMin: STOCK_MIN,
    stockMax: STOCK_MAX,
    currentGoodQuantityInCargo,
    shipStatus: toShipStatus(ship.status),
  });

  if (!result.ok) {
    return { ok: false, error: result.error, status: 400 };
  }

  const { delta } = result;

  // Hoist the current-tick read out of the transaction: it's only used by
  // the rep accrual cap, which is monotonic in tick number, so reading
  // slightly stale is safe.
  let currentTick = 0;
  if (factionId) {
    const world = await prisma.gameWorld.findUnique({
      where: { id: "world" },
      select: { currentTick: true },
    });
    currentTick = world?.currentTick ?? 0;
  }

  // Execute trade in a transaction with fresh state reads (TOCTOU guard)
  let updatedMarket;
  try {
    updatedMarket = await prisma.$transaction(async (tx) => {
      // Fresh hostile-gate check before doing any work. Snapshot price/
      // multiplier above used the pre-tx score; if a tick processor flipped
      // the player to hostile in between, abort the trade here.
      if (factionId) {
        const { tradeDenied } = await accrueTradeReputationInTx(
          tx,
          player.id,
          factionId,
          currentTick,
        );
        if (tradeDenied) throw new Error("HOSTILE_STANDING");
      }

      const freshPlayer = await tx.player.findUnique({
        where: { id: player.id },
        select: { credits: true },
      });
      if (!freshPlayer) throw new Error("PLAYER_NOT_FOUND");
      if (type === "buy" && freshPlayer.credits < delta.totalPrice) {
        throw new Error("INSUFFICIENT_CREDITS");
      }

      await tx.player.update({
        where: { id: player.id },
        data: { credits: { increment: delta.creditsDelta } },
      });

      if (type === "buy") {
        const freshCargo = await tx.cargoItem.findFirst({
          where: { shipId, goodId },
        });
        if (freshCargo) {
          await tx.cargoItem.update({
            where: { id: freshCargo.id },
            data: { quantity: { increment: delta.cargoQuantityDelta } },
          });
        } else {
          await tx.cargoItem.create({
            data: { shipId, goodId, quantity: delta.cargoQuantityDelta },
          });
        }
      } else {
        const freshCargo = await tx.cargoItem.findFirst({
          where: { shipId, goodId },
        });
        if (!freshCargo || freshCargo.quantity < quantity) {
          throw new Error("INSUFFICIENT_CARGO");
        }
        const newQty = freshCargo.quantity + delta.cargoQuantityDelta;
        if (newQty <= 0) {
          await tx.cargoItem.delete({ where: { id: freshCargo.id } });
        } else {
          await tx.cargoItem.update({
            where: { id: freshCargo.id },
            data: { quantity: newQty },
          });
        }
      }

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

      await tx.tradeHistory.create({
        data: { stationId, goodId, price: unitPrice, quantity, type, playerId: player.id },
      });

      // Increment trade volume accumulator on the system for prosperity computation
      await tx.starSystem.update({
        where: { id: ship.systemId },
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

  // Re-fetch the ship for response
  const freshShip = await prisma.ship.findUnique({
    where: { id: shipId },
    include: SHIP_INCLUDE,
  });

  if (!freshShip) {
    return { ok: false, error: "Failed to fetch updated ship state.", status: 500 };
  }

  return {
    ok: true,
    data: {
      ship: serializeShip(freshShip),
      updatedMarket: buildMarketEntry(
        updatedMarket.goodId,
        updatedMarket.good,
        updatedMarket.stock,
        govDef,
      ),
    },
  };
}
