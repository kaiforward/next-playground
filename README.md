# Stellar Trader

A browser-based multiplayer space trading game built with Next.js. Navigate star systems, trade goods between stations, and grow your wealth in a living economy.

## Prerequisites

- [Node.js](https://nodejs.org/) v18+
- npm (included with Node.js)
- Git

## Getting Started

```bash
# Install dependencies
npm install

# Set up the database
npx prisma db push
npx prisma db seed

# Start the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — register an account to start playing.

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start dev server (Turbopack) |
| `npm run build` | Production build |
| `npx vitest run` | Run unit tests |
| `npx prisma db seed` | Seed the database |
| `npx prisma db push` | Push schema changes to SQLite |
| `npx prisma studio` | Browse database in browser |

## Environment Variables

Copy `.env` or create one with:

```
AUTH_SECRET="dev-secret-change-in-production"
AUTH_URL="http://localhost:3000"
```

## Tech Stack

Next.js 16, TypeScript, Tailwind CSS v4, SQLite (Prisma 7), NextAuth v5, React Flow, Recharts.

See `docs/` for detailed architecture documentation.
