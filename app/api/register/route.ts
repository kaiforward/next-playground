import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth/credentials";
import { registerSchema } from "@/lib/schemas/auth";
import { rateLimit, getClientIp } from "@/lib/api/rate-limit";
import { RATE_LIMIT_TIERS } from "@/lib/constants/rate-limit";
import { SHIP_TYPES } from "@/lib/constants/ships";
import { buildShipData, buildUpgradeSlots } from "@/lib/engine/ship-factory";

export async function POST(request: Request) {
  const limited = rateLimit({
    key: `auth:${getClientIp(request)}`,
    tier: RATE_LIMIT_TIERS.auth,
  });
  if (limited) return limited;

  try {
    const body = await request.json();

    const result = registerSchema.safeParse(body);
    if (!result.success) {
      const message = result.error.issues
        .map((issue) => issue.message)
        .join(", ");
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const { name, email, password } = result.data;

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return NextResponse.json(
        { error: "An account with this email already exists" },
        { status: 409 },
      );
    }

    const passwordHash = await hashPassword(password);

    // Look up starting system from GameWorld
    const world = await prisma.gameWorld.findUnique({
      where: { id: "world" },
    });

    if (!world?.startingSystemId) {
      return NextResponse.json(
        { error: "Game world not initialized. Please run the seed script." },
        { status: 500 },
      );
    }

    const startingSystem = await prisma.starSystem.findUnique({
      where: { id: world.startingSystemId },
    });

    if (!startingSystem) {
      return NextResponse.json(
        { error: "Starting system not found. Please re-seed the database." },
        { status: 500 },
      );
    }

    // Create user, player, and starter ship in a transaction
    const shuttleDef = SHIP_TYPES.shuttle;
    const shipData = buildShipData(shuttleDef, "Starter Ship");
    const slotData = buildUpgradeSlots(shuttleDef.slotLayout);

    const user = await prisma.user.create({
      data: {
        name,
        email,
        passwordHash,
        player: {
          create: {
            credits: 1000,
            ships: {
              create: {
                ...shipData,
                systemId: startingSystem.id,
                upgradeSlots: { create: slotData },
              },
            },
          },
        },
      },
      select: {
        id: true,
        email: true,
        name: true,
      },
    });

    return NextResponse.json({ data: user }, { status: 201 });
  } catch (error) {
    console.error("Registration error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
