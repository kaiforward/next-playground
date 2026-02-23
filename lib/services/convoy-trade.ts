import { prisma } from "@/lib/prisma";
import { calculatePrice } from "@/lib/engine/pricing";
import { validateFleetTrade } from "@/lib/engine/trade";
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

  // Verify station is at the convoy's system
  const station = await prisma.station.findUnique({
    where: { systemId: convoy.systemId },
  });
  if (!station || station.id !== stationId) {
    return { ok: false, error: "Station is not at the convoy's system.", status: 400 };
  }

  const marketEntry = await prisma.stationMarket.findUnique({
    where: { stationId_goodId: { stationId, goodId } },
    include: { good: true },
  });
  if (!marketEntry) {
    return { ok: false, error: "Good not available at this station.", status: 404 };
  }

  const unitPrice = calculatePrice(
    marketEntry.good.basePrice,
    marketEntry.supply,
    marketEntry.demand,
    marketEntry.good.priceFloor,
    marketEntry.good.priceCeiling,
  );

  // Aggregate cargo across all member ships
  const ships = convoy.members.map((m) => m.ship);
  const combinedCargoMax = ships.reduce((s, ship) => s + ship.cargoMax, 0);
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
    unitPrice,
    playerCredits: player.credits,
    currentCargoUsed: combinedCargoUsed,
    cargoMax: combinedCargoMax,
    currentSupply: marketEntry.supply,
    currentGoodQuantityInCargo: combinedGoodQuantity,
    shipStatus: "docked",
  });

  if (!result.ok) {
    return { ok: false, error: result.error, status: 400 };
  }

  const { delta } = result;

  let updatedMarket;
  try {
    updatedMarket = await prisma.$transaction(async (tx) => {
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
          const shipCargoUsed = ship.cargo.reduce((s, c) => s + c.quantity, 0);
          const shipSpace = ship.cargoMax - shipCargoUsed;
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

      // Update market supply/demand
      const freshMarket = await tx.stationMarket.findUnique({
        where: { id: marketEntry.id },
      });

      const market = await tx.stationMarket.update({
        where: { id: marketEntry.id },
        data: {
          supply: Math.max(0, (freshMarket?.supply ?? 0) + delta.supplyDelta),
          demand: Math.max(0, (freshMarket?.demand ?? 0) + delta.demandDelta),
        },
        include: { good: true },
      });

      // Trade history
      await tx.tradeHistory.create({
        data: { stationId, goodId, price: unitPrice, quantity, type, playerId: player.id },
      });

      return market;
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "INSUFFICIENT_CREDITS") {
        return { ok: false, error: "Not enough credits. State may have changed concurrently.", status: 409 };
      }
      if (error.message === "INSUFFICIENT_CARGO") {
        return { ok: false, error: "Not enough cargo. State may have changed concurrently.", status: 409 };
      }
    }
    throw error;
  }

  const newPrice = calculatePrice(
    updatedMarket.good.basePrice,
    updatedMarket.supply,
    updatedMarket.demand,
    updatedMarket.good.priceFloor,
    updatedMarket.good.priceCeiling,
  );

  return {
    ok: true,
    data: {
      updatedMarket: {
        goodId: updatedMarket.goodId,
        goodName: updatedMarket.good.name,
        basePrice: updatedMarket.good.basePrice,
        currentPrice: newPrice,
        supply: updatedMarket.supply,
        demand: updatedMarket.demand,
      },
    },
  };
}
