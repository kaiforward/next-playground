import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "react-error-boundary";
import "./fonts.css";
import "@/app/globals.css";
import { gameStore, useGameSlice } from "@/lib/store/use-game-store";
import { selectIsReplacing } from "@/lib/store/game-store";
import { configureCommandTransport, sendCommand } from "@/lib/runtime/command-client";
import { applyOutboundMessage, markWorkerDead, handlePageHideSave } from "./worker-connection";
import { useAtlas } from "@/lib/hooks/use-atlas";
import { GameShell } from "@/components/game-shell";
import { AxeAccessibility } from "@/components/dev-tools/axe-accessibility";
import { StarMap } from "@/components/map/star-map";
import { SystemPanel } from "@/components/panels/system-panel";
import { FactionPanel } from "@/components/panels/faction-panel";
import { StyleguidePanel } from "@/components/panels/styleguide-panel";
import { StartScreen } from "@/components/start/start-screen";
import { renderErrorFallback } from "@/components/ui/error-fallback";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useNavigate } from "@/components/ui/link-provider";
import { AUTOSAVE_NAME } from "@/lib/world/save";
import { WouterRuntimeProvider } from "./wouter-link";
import { useRoute, resolveRouteGate, shouldRedirectToStart } from "./routes";
import { startHref } from "@/lib/utils/route-hrefs";
import type { InboundMessage } from "./worker/game-worker";

/**
 * The Vite shell's entry (client-runtime spec §9, build plan Task 6/11) — boots the real game
 * worker, feeds every posted frame into the one module-level `gameStore`
 * (`lib/store/use-game-store.ts`), and gates the game routes on the store's own world-existence
 * state (spec §3: "the game route renders only after the worker's ready message reports a world,
 * routing to the start screen otherwise"). `RouteBody` below renders the real map, panels, the
 * start screen and `GameShell`: the map root always renders `StarMap`, and a `/system/:id/:tab` or
 * `/factions/:id/:tab` route additionally docks the matching panel over it.
 */

const worker = new Worker(new URL("./worker/entry.ts", import.meta.url), { type: "module" });

function post(message: InboundMessage): void {
  worker.postMessage(message);
}

configureCommandTransport({
  postCommand: (envelope) => post({ type: "command", envelope }),
});

// Liveness drivers (spec §4): `worker.onerror`/`onmessageerror` mean the worker is gone — flip
// liveness to "dead" and reject every pending/future command (`markWorkerDead`,
// `client/worker-connection.ts`). Every other frame this shell receives is handled by
// `applyOutboundMessage`, which also derives the no-world/live/paused liveness transitions.
worker.onerror = (event) => {
  console.error("[shell] worker error:", event.message, event.filename, event.lineno);
  markWorkerDead(gameStore);
};
worker.onmessageerror = () => {
  console.error("[shell] worker message failed to deserialize");
  markWorkerDead(gameStore);
};

worker.onmessage = (event) => {
  applyOutboundMessage(gameStore, event.data);
};

// The pagehide save (spec §5, §11): fires an autosave command so a refresh or tab close doesn't
// discard up to 60 s of play. Fire-and-log by construction — see `handlePageHideSave`'s own
// docstring for why this cannot block navigation, and why its failure path IS the seam that feeds
// `LivenessBanner`'s autosave-failure state rather than a bug worked around here.
window.addEventListener("pagehide", () => {
  handlePageHideSave(gameStore, sendCommand, AUTOSAVE_NAME);
});

post({ type: "boot", config: { economyScale: 100, debugEconomy: false, debugEvents: false } });
post({ type: "subscribe" });

/** The map root — always mounted (a panel docks over it, never instead of it): `StarMap` reads its
 *  own selection off `useRouteInfo()` (`components/ui/link-provider.tsx`), so it needs no route
 *  prop from here, only the atlas. Wrapped in its own boundary so a map read failure doesn't take
 *  the header or an open panel down with it — mirrors the old Next app's `app/(game)/page.tsx`.
 *
 *  `key={atlas.meta.seed}` is the world-replacement teardown/rebuild mechanism (spec §8): a new
 *  world's seed is a fresh identity every time (`newGame`'s own random or player-supplied seed,
 *  `loadGame`'s saved one), so React unmounts the previous `StarMap` — destroying its Pixi canvas,
 *  camera and internal selection state — and mounts a brand-new instance against the new atlas,
 *  rather than an update pass trying to reconcile Pixi state built for a galaxy that no longer
 *  exists. */
function MapRoot() {
  const { atlas } = useAtlas();
  return (
    <div className="h-[calc(100vh-var(--topbar-height))] w-full relative">
      <ErrorBoundary fallbackRender={renderErrorFallback}>
        <StarMap
          key={atlas.meta.seed}
          atlas={atlas}
          initialSelectedSystemId={atlas.player?.homeworldSystemId}
        />
      </ErrorBoundary>
    </div>
  );
}

/** Boot/swap loading state — rendered while no state frame has landed yet (`worldVersion === null`,
 *  pre-boot) and, briefly, in the one render before the no-world→`/start` redirect effect below
 *  fires. One of the three loading states spec §3 names (boot, new game, load game) — new game and
 *  load game get their own inline pending state from `useCommandMutation`'s `isPending`
 *  (`components/start/start-screen.tsx`, `create-faction-form.tsx`), this one covers the rest. */
function BootLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center text-text-tertiary text-sm">
      Booting…
    </div>
  );
}

/**
 * The world-existence gate (spec §3, §9) — the successor to the old Next app's synchronous
 * `hasWorld()` + `redirect("/start")` (`app/(game)/layout.tsx:15-17`). One-directional, matching
 * that precedent: no world redirects every non-start route to `/start`; a live world does NOT
 * force `/start` away (Exit navigates there deliberately while the worker keeps ticking in the
 * background, so the player can return to a game in progress by navigating back).
 *
 * `GameShell` (`components/game-shell.tsx`) is the real in-game shell the old Next app mounted at
 * `app/(game)/layout.tsx` — `TickProvider`, `DevOverlayProvider`, `LivenessBanner`, the real
 * `TopBar` and the dev-tools panel come from there. Only the map + system/faction/styleguide
 * routes are wrapped; the start screen renders OUTSIDE `GameShell`, since `TopBar` reads
 * faction/treasury data that assumes a world already exists.
 */
function RouteBody() {
  const route = useRoute();
  const navigate = useNavigate();
  const worldVersion = useGameSlice((state) => state.worldVersion);
  // A world replacement in flight (`GameStore.beginWorldReplacement()`) also reads `worldVersion
  // === 0`, but is NOT "no world" — the new world is already on its way, just not landed yet. See
  // `client/routes.ts`'s own docstring (Gate C smoke finding: without this distinction, New Game
  // navigated to the map route and was immediately redirected straight back to `/start`).
  const isReplacing = useGameSlice(selectIsReplacing);
  const routeIsStart = route.name === "start";

  useEffect(() => {
    if (shouldRedirectToStart(worldVersion, routeIsStart, isReplacing)) {
      navigate(startHref(), { replace: true });
    }
  }, [worldVersion, routeIsStart, isReplacing, navigate]);

  const gate = resolveRouteGate(worldVersion, routeIsStart, isReplacing);

  if (gate === "boot-loading") return <BootLoading />;
  if (gate === "start") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-10 px-6 py-12">
        <header className="text-center">
          <h1 className="font-display font-bold uppercase tracking-widest text-4xl text-text-accent">
            Stellar Trader
          </h1>
          <p className="mt-3 text-sm text-text-tertiary">
            A living galaxy, simulated on your machine.
          </p>
        </header>
        <StartScreen />
      </div>
    );
  }

  switch (route.name) {
    case "map":
      return (
        <GameShell>
          <MapRoot />
        </GameShell>
      );
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
