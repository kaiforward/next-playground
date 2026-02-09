import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionPlayer } from "@/lib/auth/get-player";
import { serializeShip } from "@/lib/auth/serialize";
import { calculatePrice } from "@/lib/engine/pricing";
import { validateFleetTrade } from "@/lib/engine/trade";
import type { ShipTradeRequest, ShipTradeResponse } from "@/lib/types/api";

/**
 * POST /api/game/ship/[shipId]/trade
 * Execute a buy or sell trade for a specific docked ship.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ shipId: string }> },
) {
  try {
    const { shipId } = await params;

    let body: ShipTradeRequest;
    try {
      body = (await request.json()) as ShipTradeRequest;
    } catch {
      return NextResponse.json<ShipTradeResponse>(
        { error: "Invalid JSON body." },
        { status: 400 },
      );
    }
    const { stationId, goodId, quantity, type } = body;

    if (!stationId || !goodId || !type) {
      return NextResponse.json<ShipTradeResponse>(
        { error: "Missing required fields: stationId, goodId, quantity, type." },
        { status: 400 },
      );
    }

    if (!Number.isInteger(quantity) || quantity <= 0) {
      return NextResponse.json<ShipTradeResponse>(
        { error: "Quantity must be a positive integer." },
        { status: 400 },
      );
    }

    const player = await getSessionPlayer();
    if (!player) {
      return NextResponse.json<ShipTradeResponse>(
        { error: "Player not found." },
        { status: 404 },
      );
    }

    // Find the ship and verify ownership
    const ship = player.ships.find((s) => s.id === shipId);
    if (!ship) {
      return NextResponse.json<ShipTradeResponse>(
        { error: "Ship not found or does not belong to you." },
        { status: 404 },
      );
    }

    // Verify the station is in the ship's current system
    const station = await prisma.station.findUnique({
      where: { systemId: ship.systemId },
    });
    if (!station || station.id !== stationId) {
      return NextResponse.json<ShipTradeResponse>(
        { error: "Station is not in the ship's current system." },
        { status: 400 },
      );
    }

    // Look up the market entry
    const marketEntry = await prisma.stationMarket.findUnique({
      where: { stationId_goodId: { stationId, goodId } },
      include: { good: true },
    });
    if (!marketEntry) {
      return NextResponse.json<ShipTradeResponse>(
        { error: "Good not available at this station." },
        { status: 404 },
      );
    }

    const unitPrice = calculatePrice(
      marketEntry.good.basePrice,
      marketEntry.supply,
      marketEntry.demand,
    );

    const currentCargoUsed = ship.cargo.reduce((sum, c) => sum + c.quantity, 0);
    const existingCargo = ship.cargo.find((c) => c.goodId === goodId);
    const currentGoodQuantityInCargo = existingCargo?.quantity ?? 0;

    // Validate with fleet-aware trade (checks docked status)
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
      return NextResponse.json<ShipTradeResponse>(
        { error: result.error },
        { status: 400 },
      );
    }

    const { delta } = result;

    // Execute trade in a transaction with fresh state reads (TOCTOU guard)
    let updatedMarket;
    try {
      updatedMarket = await prisma.$transaction(async (tx) => {
        // Re-read player credits inside transaction for concurrency safety
        const freshPlayer = await tx.player.findUnique({
          where: { id: player.id },
          select: { credits: true },
        });
        if (!freshPlayer) throw new Error("PLAYER_NOT_FOUND");
        if (type === "buy" && freshPlayer.credits < delta.totalPrice) {
          throw new Error("INSUFFICIENT_CREDITS");
        }

        // Update player credits atomically
        await tx.player.update({
          where: { id: player.id },
          data: { credits: { increment: delta.creditsDelta } },
        });

        // Update or create cargo entry with fresh reads
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
          // Sell: re-read cargo inside transaction to verify quantity
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

        // Re-read market for fresh supply/demand
        const freshMarket = await tx.stationMarket.findUnique({
          where: { id: marketEntry.id },
        });

        // Update station market with fresh values
        const market = await tx.stationMarket.update({
          where: { id: marketEntry.id },
          data: {
            supply: Math.max(0, (freshMarket?.supply ?? 0) + delta.supplyDelta),
            demand: Math.max(0, (freshMarket?.demand ?? 0) + delta.demandDelta),
          },
          include: { good: true },
        });

        // Create trade history
        await tx.tradeHistory.create({
          data: { stationId, goodId, price: unitPrice, quantity, type, playerId: player.id },
        });

        return market;
      });
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === "INSUFFICIENT_CREDITS") {
          return NextResponse.json<ShipTradeResponse>(
            { error: "Not enough credits. State may have changed concurrently." },
            { status: 409 },
          );
        }
        if (error.message === "INSUFFICIENT_CARGO") {
          return NextResponse.json<ShipTradeResponse>(
            { error: "Not enough cargo. State may have changed concurrently." },
            { status: 409 },
          );
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
      return NextResponse.json<ShipTradeResponse>(
        { error: "Failed to fetch updated ship state." },
        { status: 500 },
      );
    }

    const newPrice = calculatePrice(
      updatedMarket.good.basePrice,
      updatedMarket.supply,
      updatedMarket.demand,
    );

    return NextResponse.json<ShipTradeResponse>({
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
    });
  } catch (error) {
    console.error("POST /api/game/ship/[shipId]/trade error:", error);
    return NextResponse.json<ShipTradeResponse>(
      { error: "Failed to execute trade." },
      { status: 500 },
    );
  }
}
