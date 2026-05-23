# Stellar Trader

A browser-based multiplayer space trading game built with Next.js. Navigate star systems, trade goods between stations, and grow your wealth in a living economy.

## Prerequisites

- [Node.js](https://nodejs.org/) v18+
- npm (included with Node.js)
- Git
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) — runs the PostgreSQL container

## Getting Started

```bash
# Install dependencies
npm install

# Start PostgreSQL (Docker Desktop must be running)
docker compose up -d

# Set up the database
npx prisma db push
npx prisma db seed

# Start the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — register an account to start playing.

If you see `ECONNREFUSED` from Prisma, the Postgres container isn't running. Start Docker Desktop, then `docker compose up -d`.

## Scripts

| Command | Description |
|---|---|
| `docker compose up -d` | Start the PostgreSQL container |
| `docker compose down` | Stop the PostgreSQL container |
| `npm run dev` | Start dev server (Turbopack) |
| `npm run build` | Production build |
| `npx vitest run` | Run unit tests |
| `npx prisma db seed` | Seed the database |
| `npx prisma db push` | Push schema changes to PostgreSQL |
| `npx prisma studio` | Browse database in browser |

## Environment Variables

Copy `.env` or create one with:

```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/stellar_trader"
AUTH_SECRET="dev-secret-change-in-production"
AUTH_URL="http://localhost:3000"
UNIVERSE_SCALE="default"   # "default" (600 systems) or "10k" (10,000 systems)
```

## Tech Stack

Next.js 16, TypeScript, Tailwind CSS v4, PostgreSQL (Prisma 7), NextAuth v5, React Flow, Recharts.

See `docs/` for detailed architecture documentation.
