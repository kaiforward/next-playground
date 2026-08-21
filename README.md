# Stellar Trader

A single-player grand-strategy game in a procedurally generated galaxy — colonise, develop worlds under physical constraints, and steer a living simulated economy. The whole simulation runs in-browser inside a Web Worker: no server, no login, no database. Saves are JSON snapshots stored in IndexedDB.

## Prerequisites

- [Node.js](https://nodejs.org/) v18+
- npm (included with Node.js)
- Git

## Getting Started

```bash
# Install dependencies
npm install

# Start the dev server
npm run dev
```

Open the dev server URL, then **New game** to generate a galaxy.

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the dev server (Vite) |
| `npm run build` | Build gate: `tsc && vite build` |
| `npx vitest run` | Run unit tests |
| `npm run simulate` | Headless run of the real tick loop, for economy evidence |

## Tech Stack

Vite + React 19, TypeScript (strict), Tailwind CSS v4, Zustand, wouter, React Flow, Recharts, Vitest.

See `docs/SPEC.md` for the functional spec and `docs/active/` for shipped-system documentation.
