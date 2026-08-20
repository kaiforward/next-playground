import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StartScreen } from "../start-screen";
import { NavigateProvider } from "@/components/ui/link-provider";
import { configureCommandTransport, deliverCommandResult } from "@/lib/runtime/command-client";
import { AUTOSAVE_NAME } from "@/lib/world/save";
import { gameStore } from "@/lib/store/use-game-store";
import type { GameCommandEnvelope } from "@/client/worker/game-worker";

// jsdom doesn't implement <dialog>'s imperative methods — `Dialog` (components/ui/dialog.tsx)
// calls `.show()`/`.showModal()`/`.close()` in an effect, which throws without this polyfill. No
// existing test exercises `Dialog` yet (grep, 2026-08-20), so this is scoped to this file rather
// than the shared component setup.
if (typeof HTMLDialogElement !== "undefined") {
  HTMLDialogElement.prototype.show ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.open = false;
  };
}

// Proves 1's client half (client-runtime build plan Task 11): listSaves/loadGame/newGame are all
// worker commands valid world-less, and a successful load/new-game navigates to the map root.

let posted: GameCommandEnvelope[];

beforeEach(() => {
  posted = [];
  configureCommandTransport({
    postCommand: (envelope) => {
      posted.push(envelope);
      // listSaves auto-answers synchronously with an empty list by default — individual tests
      // deliver their own result for the command under test (load/newGame) explicitly.
      if (envelope.type === "listSaves") {
        deliverCommandResult({ type: "commandResult", id: envelope.id, result: { ok: true, data: [] } });
      }
    },
  });
});

afterEach(() => {
  configureCommandTransport(null);
});

function renderStartScreen() {
  const navigate = vi.fn();
  render(
    <NavigateProvider navigate={navigate}>
      <StartScreen />
    </NavigateProvider>,
  );
  return { navigate };
}

describe("StartScreen — saves list", () => {
  it("lists saves via the listSaves command and shows the empty state when none exist", async () => {
    renderStartScreen();
    expect(await screen.findByText("No saved games yet.")).toBeInTheDocument();
    expect(posted.some((e) => e.type === "listSaves")).toBe(true);
  });

  // Gate C smoke finding B (owner, `npx vite dev`): the saves list showed the raw
  // "Failed to fetch dynamically imported module …/lib/world/save-files.ts" error — the worker's
  // `listSaves` handler dynamic-importing the Node file backend, which cannot load in a browser
  // until Task 12. This pins the honest replacement and that New Game stays unaffected.
  it("shows an honest, quiet message (never the raw import-failure text) when listSaves rejects, and leaves New Game usable", async () => {
    configureCommandTransport({
      postCommand: (envelope) => {
        posted.push(envelope);
        if (envelope.type === "listSaves") {
          deliverCommandResult({
            type: "commandResult",
            id: envelope.id,
            result: {
              ok: false,
              error: "Failed to fetch dynamically imported module '/lib/world/save-files.ts'",
            },
          });
        }
      },
    });
    renderStartScreen();

    expect(await screen.findByText("Saves aren't available in the browser yet.")).toBeInTheDocument();
    expect(screen.queryByText(/dynamically imported module/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/save-files\.ts/)).not.toBeInTheDocument();

    // New Game is a wholly separate command (`newGame` never touches the save backend) — the
    // saves-list failure must not disable it.
    const newGameButton = screen.getByRole("button", { name: "New Game" });
    expect(newGameButton).toBeEnabled();
    await userEvent.click(newGameButton);
    expect(await screen.findByLabelText("Faction name")).toBeInTheDocument();
  });
});

describe("StartScreen — load", () => {
  it("loads the autosave and navigates to the map root on success", async () => {
    configureCommandTransport({
      postCommand: (envelope) => {
        posted.push(envelope);
        if (envelope.type === "listSaves") {
          deliverCommandResult({
            type: "commandResult",
            id: envelope.id,
            result: {
              ok: true,
              data: [{ name: AUTOSAVE_NAME, tick: 42, savedAt: new Date().toISOString(), bytes: 1000 }],
            },
          });
        }
      },
    });
    const { navigate } = renderStartScreen();
    // Simulate the "New game from a live game" scenario (Proof 1): a real world's data is already
    // sitting in the store (e.g. the player Exit-ed a live game to reach /start).
    gameStore.applyStateFrame({ worldVersion: 99, slices: { visibility: { systemIds: ["sys-1"] } } });

    const continueButton = await screen.findByRole("button", { name: "Continue" });
    await userEvent.click(continueButton);

    await waitFor(() => expect(posted.some((e) => e.type === "loadGame")).toBe(true));
    const loadEnvelope = posted.find((e) => e.type === "loadGame");
    if (!loadEnvelope) throw new Error("loadGame envelope not posted");

    // Proves 4 (swap-window reset): dispatched synchronously, well before the load's own result.
    expect(gameStore.getSnapshot().worldVersion).toBe(0);

    deliverCommandResult({
      type: "commandResult",
      id: loadEnvelope.id,
      result: { ok: true, data: { seed: 1, systemCount: 600, mapSize: 1000, currentTick: 42 } },
    });

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/"));
  });

  // The same Task-12 seam as the saves-list finding: `loadGame` dynamic-imports the identical Node
  // backend, so it rejects with the same raw import-failure text pre-Task-12.
  it("shows the same honest, quiet message (never the raw import-failure text) when loadGame rejects", async () => {
    configureCommandTransport({
      postCommand: (envelope) => {
        posted.push(envelope);
        if (envelope.type === "listSaves") {
          deliverCommandResult({
            type: "commandResult",
            id: envelope.id,
            result: {
              ok: true,
              data: [{ name: AUTOSAVE_NAME, tick: 42, savedAt: new Date().toISOString(), bytes: 1000 }],
            },
          });
        }
      },
    });
    renderStartScreen();

    const continueButton = await screen.findByRole("button", { name: "Continue" });
    await userEvent.click(continueButton);

    await waitFor(() => expect(posted.some((e) => e.type === "loadGame")).toBe(true));
    const loadEnvelope = posted.find((e) => e.type === "loadGame");
    if (!loadEnvelope) throw new Error("loadGame envelope not posted");

    deliverCommandResult({
      type: "commandResult",
      id: loadEnvelope.id,
      result: {
        ok: false,
        error: "Failed to fetch dynamically imported module '/lib/world/save-files.ts'",
      },
    });

    expect(await screen.findByText("Saves aren't available in the browser yet.")).toBeInTheDocument();
    expect(screen.queryByText(/dynamically imported module/i)).not.toBeInTheDocument();
  });
});

describe("StartScreen — new game dialog", () => {
  it("opens the create-faction form on New Game", async () => {
    renderStartScreen();
    await screen.findByText("No saved games yet.");

    await userEvent.click(screen.getByRole("button", { name: "New Game" }));

    expect(await screen.findByLabelText("Faction name")).toBeInTheDocument();
  });
});
