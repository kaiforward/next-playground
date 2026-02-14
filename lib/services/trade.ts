import { prisma } from "@/lib/prisma";
import { serializeShip } from "@/lib/auth/serialize";
import { calculatePrice } from "@/lib/engine/pricing";
import { validateFleetTrade } from "@/lib/engine/trade";
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
    },
  });

  if (!ship || ship.playerId !== playerId) {
    return { ok: false, error: "Ship not found or does not belong to you.", status: 404 };
  }

  // Verify station is in the ship's current system
  const station = await prisma.station.findUnique({
    where: { systemId: ship.systemId },
  });
  if (!station || station.id !== stationId) {
    return { ok: false, error: "Station is not in the ship's current system.", status: 400 };
  }

  // Look up the market entry
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

  const currentCargoUsed = ship.cargo.reduce((sum, c) => sum + c.quantity, 0);
  const existingCargo = ship.cargo.find((c) => c.goodId === goodId);
  const currentGoodQuantityInCargo = existingCargo?.quantity ?? 0;

  const result = validateFleetTrade({
    type,
    quantity,
    unitPrice,
    playerCredits: player.credits,
    currentCargoUsed,
    cargoMax: ship.cargoMax,
    currentSupply: marketEntry.supply,
    currentGoodQuantityInCargo,
    shipStatus: ship.status as "docked" | "in_transit",
  });

  if (!result.ok) {
    return { ok: false, error: result.error, status: 400 };
  }

  const { delta } = result;

  // Execute trade in a transaction with fresh state reads (TOCTOU guard)
  let updatedMarket;
  try {
    updatedMarket = await prisma.$transaction(async (tx) => {
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

      const market = await tx.stationMarket.update({
        where: { id: marketEntry.id },
        data: {
          supply: Math.max(0, (freshMarket?.supply ?? 0) + delta.supplyDelta),
          demand: Math.max(0, (freshMarket?.demand ?? 0) + delta.demandDelta),
        },
        include: { good: true },
      });

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

  // Re-fetch the ship for response
  const freshShip = await prisma.ship.findUnique({
    where: { id: shipId },
    include: {
      cargo: { include: { good: true } },
      system: true,
      destination: true,
    },
  });

  if (!freshShip) {
    return { ok: false, error: "Failed to fetch updated ship state.", status: 500 };
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
      ship: serializeShip(freshShip),
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
