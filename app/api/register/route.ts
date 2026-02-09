import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth/credentials";
import { registerSchema } from "@/lib/schemas/auth";

export async function POST(request: Request) {
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

    // Find the Sol star system for starting location
    const solSystem = await prisma.starSystem.findUnique({
      where: { name: "Sol" },
    });

    if (!solSystem) {
      return NextResponse.json(
        { error: "Game world not initialized. Please run the seed script." },
        { status: 500 },
      );
    }

    // Create user, player, and starter ship in a transaction
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
                name: "Starter Ship",
                fuel: 100,
                maxFuel: 100,
                cargoMax: 50,
                systemId: solSystem.id,
                status: "docked",
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
