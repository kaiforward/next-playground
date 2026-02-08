import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionPlayer } from "@/lib/auth/get-player";
import { calculatePrice } from "@/lib/engine/pricing";
import { validateAndCalculateTrade } from "@/lib/engine/trade";
import type { TradeRequest } from "@/lib/types/api";
import type { TradeResponse } from "@/lib/types/api";
import type { EconomyType } from "@/lib/types/game";

/**
 * POST /api/game/trade
 * Execute a buy or sell trade at a station.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as TradeRequest;
    const { stationId, goodId, quantity, type } = body;

    if (!stationId || !goodId || !quantity || !type) {
      return NextResponse.json<TradeResponse>(
        { error: "Missing required fields: stationId, goodId, quantity, type." },
        { status: 400 },
      );
    }

    const player = await getSessionPlayer();

    if (!player || !player.ship) {
      return NextResponse.json<TradeResponse>(
        { error: "Player or ship not found." },
        { status: 404 },
      );
    }

    // Look up the market entry
    const marketEntry = await prisma.stationMarket.findUnique({
      where: {
        stationId_goodId: { stationId, goodId },
      },
      include: { good: true },
    });

    if (!marketEntry) {
      return NextResponse.json<TradeResponse>(
        { error: "Good not available at this station." },
        { status: 404 },
      );
    }

    // Calculate current price
    const unitPrice = calculatePrice(
      marketEntry.good.basePrice,
      marketEntry.supply,
      marketEntry.demand,
    );

    // Calculate current cargo usage
    const currentCargoUsed = player.ship.cargo.reduce(
      (sum, c) => sum + c.quantity,
      0,
    );

    // Find existing cargo entry for this good
    const existingCargo = player.ship.cargo.find((c) => c.goodId === goodId);
    const currentGoodQuantityInCargo = existingCargo?.quantity ?? 0;

    // Validate and calculate trade
    const result = validateAndCalculateTrade({
      type,
      quantity,
      unitPrice,
      playerCredits: player.credits,
      currentCargoUsed,
      cargoMax: player.ship.cargoMax,
      currentSupply: marketEntry.supply,
      currentGoodQuantityInCargo,
    });

    if (!result.ok) {
      return NextResponse.json<TradeResponse>(
        { error: result.error },
        { status: 400 },
      );
    }

    const { delta } = result;

    // Execute the trade in a transaction
    const updatedData = await prisma.$transaction(async (tx) => {
      // Update player credits
      const updatedPlayer = await tx.player.update({
        where: { id: player.id },
        data: { credits: player.credits + delta.creditsDelta },
        include: {
          system: true,
          ship: {
            include: {
              cargo: { include: { good: true } },
            },
          },
        },
      });

      // Update or create cargo entry
      if (type === "buy") {
        if (existingCargo) {
          await tx.cargoItem.update({
            where: { id: existingCargo.id },
            data: { quantity: existingCargo.quantity + delta.cargoQuantityDelta },
          });
        } else {
          await tx.cargoItem.create({
            data: {
              shipId: player.ship!.id,
              goodId,
              quantity: delta.cargoQuantityDelta,
            },
          });
        }
      } else {
        // sell
        const newQty = currentGoodQuantityInCargo + delta.cargoQuantityDelta; // delta is negative for sell
        if (newQty <= 0 && existingCargo) {
          await tx.cargoItem.delete({ where: { id: existingCargo.id } });
        } else if (existingCargo) {
          await tx.cargoItem.update({
            where: { id: existingCargo.id },
            data: { quantity: newQty },
          });
        }
      }

      // Update station market supply and demand
      const updatedMarket = await tx.stationMarket.update({
        where: { id: marketEntry.id },
        data: {
          supply: Math.max(0, marketEntry.supply + delta.supplyDelta),
          demand: Math.max(0, marketEntry.demand + delta.demandDelta),
        },
        include: { good: true },
      });

      // Create trade history record
      await tx.tradeHistory.create({
        data: {
          stationId,
          goodId,
          price: unitPrice,
          quantity,
          type,
          playerId: player.id,
        },
      });

      return { updatedPlayer, updatedMarket };
    });

    // Re-fetch updated player for response (cargo may have changed)
    const freshPlayer = await prisma.player.findUnique({
      where: { id: player.id },
      include: {
        system: true,
        ship: {
          include: {
            cargo: { include: { good: true } },
          },
        },
      },
    });

    if (!freshPlayer || !freshPlayer.ship) {
      return NextResponse.json<TradeResponse>(
        { error: "Failed to fetch updated player state." },
        { status: 500 },
      );
    }

    const newPrice = calculatePrice(
      updatedData.updatedMarket.good.basePrice,
      updatedData.updatedMarket.supply,
      updatedData.updatedMarket.demand,
    );

    return NextResponse.json<TradeResponse>({
      data: {
        player: {
          id: freshPlayer.id,
          userId: freshPlayer.userId,
          credits: freshPlayer.credits,
          systemId: freshPlayer.systemId,
          system: {
            id: freshPlayer.system.id,
            name: freshPlayer.system.name,
            economyType: freshPlayer.system.economyType as EconomyType,
            x: freshPlayer.system.x,
            y: freshPlayer.system.y,
            description: freshPlayer.system.description,
          },
          ship: {
            id: freshPlayer.ship.id,
            name: freshPlayer.ship.name,
            fuel: freshPlayer.ship.fuel,
            maxFuel: freshPlayer.ship.maxFuel,
            cargoMax: freshPlayer.ship.cargoMax,
            cargo: freshPlayer.ship.cargo.map((c) => ({
              goodId: c.goodId,
              goodName: c.good.name,
              quantity: c.quantity,
            })),
          },
        },
        updatedMarket: {
          goodId: updatedData.updatedMarket.goodId,
          goodName: updatedData.updatedMarket.good.name,
          basePrice: updatedData.updatedMarket.good.basePrice,
          currentPrice: newPrice,
          supply: updatedData.updatedMarket.supply,
          demand: updatedData.updatedMarket.demand,
        },
      },
    });
  } catch (error) {
    console.error("POST /api/game/trade error:", error);
    return NextResponse.json<TradeResponse>(
      { error: "Failed to execute trade." },
      { status: 500 },
    );
  }
}
