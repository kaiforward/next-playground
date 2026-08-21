import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StartScreen } from "../start-screen";
import { NavigateProvider } from "@/components/ui/link-provider";
import {
  configureCommandTransport,
  deliverCommandResult,
  type AnyCommandEnvelope,
} from "@/lib/runtime/command-client";
import { AUTOSAVE_NAME } from "@/lib/world/save";
import { gameStore } from "@/lib/store/use-game-store";

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

// Proves 1's client half: listSaves/loadGame/newGame are all
// worker commands valid world-less, and a successful load/new-game navigates to the map root.

let posted: AnyCommandEnvelope[];

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

  // The browser save backend is real now (IndexedDB), so a `listSaves`
  // rejection is a genuine failure (quota, corruption) worth showing verbatim — the old
  // "Saves aren't available in the browser yet" placeholder this test used to pin is gone.
  it("shows the real error text when listSaves rejects, and leaves New Game usable", async () => {
    configureCommandTransport({
      postCommand: (envelope) => {
        posted.push(envelope);
        if (envelope.type === "listSaves") {
          deliverCommandResult({
            type: "commandResult",
            id: envelope.id,
            result: { ok: false, error: "IndexedDB quota exceeded" },
          });
        }
      },
    });
    renderStartScreen();

    expect(await screen.findByText("IndexedDB quota exceeded")).toBeInTheDocument();

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
    gameStore.applyStateFrame({ frameSeq: 1, worldVersion: 99, slices: { visibility: { systemIds: ["sys-1"] } } });

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

  // Same reasoning as the saves-list finding above — `loadGame`'s failure is
  // now real and shown verbatim.
  it("shows the real error text when loadGame rejects", async () => {
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
      result: { ok: false, error: "Save \"autosave\" not found" },
    });

    expect(await screen.findByText('Save "autosave" not found')).toBeInTheDocument();
  });
});

describe("StartScreen — export/import", () => {
  it("exports a save by triggering the exportSave command and downloading the returned JSON", async () => {
    const downloaded: { filename: string; content: string }[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:mock");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = originalCreateElement(tag);
      if (tag === "a") {
        vi.spyOn(el as HTMLAnchorElement, "click").mockImplementation(() => {
          downloaded.push({ filename: (el as HTMLAnchorElement).download, content: "" });
        });
      }
      return el;
    });

    configureCommandTransport({
      postCommand: (envelope) => {
        posted.push(envelope);
        if (envelope.type === "listSaves") {
          deliverCommandResult({
            type: "commandResult",
            id: envelope.id,
            result: {
              ok: true,
              data: [{ name: "mysave", tick: 5, savedAt: new Date().toISOString(), bytes: 100 }],
            },
          });
        } else if (envelope.type === "exportSave") {
          deliverCommandResult({
            type: "commandResult",
            id: envelope.id,
            result: { ok: true, data: { name: "mysave", json: '{"formatVersion":15}' } },
          });
        }
      },
    });
    renderStartScreen();

    const exportButtons = await screen.findAllByRole("button", { name: /^Export$/ });
    await userEvent.click(exportButtons[exportButtons.length - 1]);

    await waitFor(() => expect(posted.some((e) => e.type === "exportSave")).toBe(true));
    await waitFor(() => expect(downloaded).toHaveLength(1));
    expect(downloaded[0].filename).toBe("mysave.json");

    vi.restoreAllMocks();
  });

  it("rejects an invalid imported file with a visible message, not a throw", async () => {
    configureCommandTransport({
      postCommand: (envelope) => {
        posted.push(envelope);
        if (envelope.type === "listSaves") {
          deliverCommandResult({ type: "commandResult", id: envelope.id, result: { ok: true, data: [] } });
        } else if (envelope.type === "importSave") {
          deliverCommandResult({
            type: "commandResult",
            id: envelope.id,
            result: { ok: false, error: "Incompatible save: Save file is not valid JSON" },
          });
        }
      },
    });
    renderStartScreen();
    await screen.findByText("No saved games yet.");

    const fileInput = screen.getByLabelText("Import save file");
    const badFile = new File(["not json"], "broken.json", { type: "application/json" });

    // The file input change handler and the async read/command dispatch it triggers must never
    // throw out of the event handler — a rendered error message is the only observable outcome.
    await expect(
      userEvent.upload(fileInput as HTMLInputElement, badFile),
    ).resolves.not.toThrow();

    expect(await screen.findByText("Incompatible save: Save file is not valid JSON")).toBeInTheDocument();
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
