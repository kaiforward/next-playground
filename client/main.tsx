import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "react-error-boundary";
import "./fonts.css";
import "@/app/globals.css";
import { gameStore } from "@/lib/store/use-game-store";
import { configureCommandTransport, deliverCommandResult } from "@/lib/runtime/command-client";
import { useAtlas } from "@/lib/hooks/use-atlas";
import { GameShell } from "@/components/game-shell";
import { AxeAccessibility } from "@/components/dev-tools/axe-accessibility";
import { StarMap } from "@/components/map/star-map";
import { SystemPanel } from "@/components/panels/system-panel";
import { FactionPanel } from "@/components/panels/faction-panel";
import { StyleguidePanel } from "@/components/panels/styleguide-panel";
import { renderErrorFallback } from "@/components/ui/error-fallback";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { NewGameInput } from "@/lib/schemas/game-setup";
import { WouterRuntimeProvider } from "./wouter-link";
import { useRoute } from "./routes";
import type { InboundMessage, OutboundMessage, GameCommandEnvelope } from "./worker/game-worker";

/**
 * The Vite shell's entry (client-runtime spec §9, build plan Task 6) — boots the real game worker
 * and feeds every posted frame into the one module-level `gameStore` (`lib/store/use-game-store.ts`).
 * `RouteBody` below renders the real map, panels and `GameShell` (Task 10): the map root always
 * renders `StarMap`, and a `/system/:id/:tab` or `/factions/:id/:tab` route additionally docks the
 * matching panel over it — mirroring the old Next app's page + `@panel` parallel-route split, but as
 * one component switching on `useRoute()` rather than two route trees. The start screen is still
 * Task 11's job.
 */

const worker = new Worker(new URL("./worker/entry.ts", import.meta.url), { type: "module" });

function post(message: InboundMessage): void {
  worker.postMessage(message);
}

function postCommand(envelope: GameCommandEnvelope): void {
  post({ type: "command", envelope });
}

// Wires every `lib/hooks/` mutation hook's `sendCommand` (`lib/runtime/command-client.ts`, Task 8)
// to this real worker connection — the "shell initialises it with the host connection" half of that
// module's own seam contract (a test initialises it with a fake `CommandTransport` instead). Not in
// Task 8's own Files list (this file is Task 6's), but without this wiring the command-dispatching
// hooks built this task would have no real transport outside tests — deviation named in the PR
// description.
configureCommandTransport({ postCommand });

// Task 11 owns the real liveness state machine; until then a dying worker must at least say so.
worker.onerror = (event) => {
  console.error("[shell] worker error:", event.message, event.filename, event.lineno);
};
worker.onmessageerror = () => {
  console.error("[shell] worker message failed to deserialize");
};

worker.onmessage = (event: MessageEvent<OutboundMessage>) => {
  const message = event.data;
  switch (message.type) {
    case "pacing":
      gameStore.applyPacingFrame(message.frame);
      return;
    case "state":
      if (import.meta.env.DEV) {
        console.log("[shell] state frame:", message.frame.worldVersion,
          "slices:", Object.keys(message.frame.slices).length);
      }
      gameStore.applyStateFrame(message.frame);
      return;
    case "tickFailed":
      // The full liveness state machine (worker.onerror/onmessageerror, heartbeat, the dead-worker
      // banner) is Task 11's job (spec §4) — this shell only carries the field far enough to prove
      // the message reaches the UI thread at all.
      gameStore.setLiveness("paused");
      return;
    case "commandResult":
      // Task 8's mutation hooks correlate results back to the control that issued them (the
      // "in-flight" rule) through `lib/runtime/command-client.ts`'s per-id resolver registry —
      // deliver every result there first. Until Task 11 builds the real failure surfaces, a
      // rejected command must still not vanish silently — log it so a browser-side failure is
      // diagnosable at all (the hook itself also surfaces it to its own caller).
      deliverCommandResult(message);
      if (!message.result.ok) {
        console.error("[shell] command rejected:", message.id, message.result.error);
      }
      return;
  }
};

/**
 * Task 6 has no start screen yet (Task 11's job, which removes this whole block) — the
 * end-to-end proof this task owes (a top-bar clock actually advancing in the browser) needs some
 * ticking world to read. If the worker reports world-less after its first frame, this spins one up
 * with fixed defaults so the shell has something to show. A stand-in for the real new-game flow,
 * not a design decision — a Task 6 judgment call, named in the PR description.
 *
 * Gated on `import.meta.env.DEV` (Vite's dev-mode flag, true under `vite dev` and false in a
 * `vite build` production bundle) so this never ships: Gate B's manual smoke runs under `vite dev`,
 * where it's still on, but a production build silently has no auto-boot — the real lifecycle
 * (Task 11) is the only thing that starts a game there.
 */
const DEV_NEW_GAME: NewGameInput = {
  systemCount: 50,
  name: "Dev Faction",
  governmentType: "federation",
  doctrine: "expansionist",
};

if (import.meta.env.DEV) {
  const unsubscribeBoot = gameStore.subscribe(() => {
    const { worldVersion } = gameStore.getSnapshot();
    if (worldVersion === null) return;
    unsubscribeBoot();
    if (worldVersion === 0) {
      console.log("[shell] world-less store observed — posting dev newGame");
      postCommand({ id: crypto.randomUUID(), type: "newGame", payload: DEV_NEW_GAME });
    }
  });
}

post({ type: "boot", config: { economyScale: 100, debugEconomy: false, debugEvents: false } });
post({ type: "subscribe" });

/** The map root — always mounted (a panel docks over it, never instead of it): `StarMap` reads its
 *  own selection off `useRouteInfo()` (`components/ui/link-provider.tsx`), so it needs no route
 *  prop from here, only the atlas. Wrapped in its own boundary so a map read failure doesn't take
 *  the header or an open panel down with it — mirrors the old Next app's `app/(game)/page.tsx`. */
function MapRoot() {
  const { atlas } = useAtlas();
  return (
    <div className="h-[calc(100vh-var(--topbar-height))] w-full relative">
      <ErrorBoundary fallbackRender={renderErrorFallback}>
        <StarMap atlas={atlas} initialSelectedSystemId={atlas.player?.homeworldSystemId} />
      </ErrorBoundary>
    </div>
  );
}

/**
 * `GameShell` (`components/game-shell.tsx`) is the real in-game shell the old Next app mounted at
 * `app/(game)/layout.tsx` — `TickProvider`, `DevOverlayProvider`, the real `TopBar` (save/exit,
 * speed, tick/tps, faction stats) and the dev-tools panel now come from there instead of this
 * file's Task 6 stand-ins (removed this task; `SystemCadenceCountdown` and `star-map.tsx`'s
 * `useDevOverlay()` calls, the reason those stand-ins existed, are satisfied by `GameShell`'s own
 * providers). Only the map + system/faction/styleguide routes are wrapped — `GameQueryProvider`
 * (TanStack, retired from this host already) is dropped, and the world-existence redirect
 * `app/(game)/layout.tsx` also did (`hasWorld()` → `/start`) stays Task 11's job: the "start" route
 * below renders its placeholder OUTSIDE `GameShell`, since `TopBar` reads faction/treasury data
 * that assumes a world already exists.
 */
function RouteBody() {
  const route = useRoute();
  switch (route.name) {
    case "map":
      return (
        <GameShell>
          <MapRoot />
        </GameShell>
      );
    case "start":
      // Task 11's job — the start screen becomes reachable world-less (listSaves/newGame/loadGame
      // as worker commands). Until then the dev auto-newGame below stands in. Deliberately NOT
      // wrapped in GameShell: TopBar assumes a live world.
      return <div>Start screen (placeholder — Task 11)</div>;
    case "system":
      return (
        <GameShell panel={<SystemPanel systemId={route.systemId} tab={route.tab} />}>
          <MapRoot />
        </GameShell>
      );
    case "faction":
      return (
        <GameShell panel={<FactionPanel factionId={route.factionId} tab={route.tab} />}>
          <MapRoot />
        </GameShell>
      );
    case "styleguide":
      return (
        <GameShell>
          <StyleguidePanel />
        </GameShell>
      );
  }
}

function App() {
  return (
    <WouterRuntimeProvider>
      {/* One app-wide Radix tooltip provider, matching `app/(game)/layout.tsx`'s today — every
          Tooltip consumer (panels, map controls, form legends) expects exactly one ancestor. */}
      <TooltipProvider delayDuration={150}>
        <RouteBody />
      </TooltipProvider>
      {import.meta.env.DEV && <AxeAccessibility />}
    </WouterRuntimeProvider>
  );
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("client/index.html is missing #root");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
