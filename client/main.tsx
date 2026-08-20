import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/app/globals.css";
import { gameStore, useGameSlice } from "@/lib/store/use-game-store";
import { configureCommandTransport, deliverCommandResult } from "@/lib/runtime/command-client";
import { LinkProvider } from "@/components/ui/link-provider";
import type { Speed } from "@/lib/world/tick-loop";
import type { NewGameInput } from "@/lib/schemas/game-setup";
import { WouterLinkAdapter } from "./wouter-link";
import { useRoute } from "./routes";
import type { InboundMessage, OutboundMessage, GameCommandEnvelope } from "./worker/game-worker";

/**
 * The Vite shell's entry (client-runtime spec §9, build plan Task 6) — boots the real game worker,
 * feeds every posted frame into the one module-level `gameStore` (`lib/store/use-game-store.ts`),
 * and renders a minimal router + top-bar clock + speed control. This is deliberately not the real
 * game UI: Stage C (Tasks 7-11) moves the actual panels, map and start screen over. What this file
 * has to prove is narrower and load-bearing — the worker boots, ticks, and the UI thread observes
 * it with no server involved (Gate B's manual smoke: "clock + speed only; panels are Stage C").
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

const SPEEDS: readonly Speed[] = ["paused", 1, 5, "max"];

function speedLabel(speed: Speed): string {
  if (speed === "paused") return "Pause";
  if (speed === "max") return "Max";
  return `${speed}x`;
}

function TopBarClock() {
  const pacing = useGameSlice((state) => state.pacing);
  if (!pacing) {
    return <span>Booting…</span>;
  }
  return (
    <span>
      Tick {pacing.currentTick} · {speedLabel(pacing.speed)} · {pacing.achievedTps.toFixed(1)} tps
    </span>
  );
}

function SpeedControl() {
  const speed = useGameSlice((state) => state.pacing?.speed ?? "paused");
  return (
    <div role="group" aria-label="Game speed">
      {SPEEDS.map((candidate) => (
        <button
          key={String(candidate)}
          type="button"
          aria-pressed={speed === candidate}
          onClick={() =>
            postCommand({ id: crypto.randomUUID(), type: "setSpeed", payload: { speed: candidate } })
          }
        >
          {speedLabel(candidate)}
        </button>
      ))}
    </div>
  );
}

function RouteBody() {
  const route = useRoute();
  switch (route.name) {
    case "map":
      return <div>Map (placeholder — Stage C)</div>;
    case "start":
      return <div>Start screen (placeholder — Task 11)</div>;
    case "system":
      return (
        <div>
          System {route.systemId} · {route.tab} (placeholder — Stage C)
        </div>
      );
    case "faction":
      return (
        <div>
          Faction {route.factionId} · {route.tab} (placeholder — Stage C)
        </div>
      );
    case "styleguide":
      // The real styleguide page exists (`app/(game)/@panel/styleguide/page.tsx`) but does not
      // import cleanly outside Next: it renders through `DetailPanel`
      // (`components/ui/detail-panel.tsx:4`), which calls `next/navigation`'s `useRouter()` — a
      // hook with no meaning outside Next's router context, and no equivalent Task 6 is asked to
      // build (DetailPanel's own router-agnosticism is Task 9's job, not named in this task's
      // Files list). Placeholder here, per the task's own fallback instruction; deviation noted in
      // the PR description.
      return <div>Styleguide (placeholder — DetailPanel isn't router-agnostic yet, Task 9)</div>;
  }
}

function App() {
  return (
    <LinkProvider component={WouterLinkAdapter}>
      <header>
        <TopBarClock />
        <SpeedControl />
      </header>
      <main>
        <RouteBody />
      </main>
    </LinkProvider>
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
