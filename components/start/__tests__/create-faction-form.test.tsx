import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CreateFactionForm } from "../create-faction-form";
import { NavigateProvider } from "@/components/ui/link-provider";
import { gameStore } from "@/lib/store/use-game-store";
import { configureCommandTransport, deliverCommandResult } from "@/lib/runtime/command-client";
import type { GameCommandEnvelope } from "@/client/worker/game-worker";

// Proves 1's client half (client-runtime build plan Task 11): new game from a live game lands on
// the map root — pinned here as "a successful newGame command navigates to the map root and resets
// the store to no-world before the command even resolves" (the swap-window reset, Proves 4).

function renderForm(onSuccess?: () => void) {
  const navigate = vi.fn();
  render(
    <NavigateProvider navigate={navigate}>
      <CreateFactionForm onSuccess={onSuccess} />
    </NavigateProvider>,
  );
  return { navigate };
}

let posted: GameCommandEnvelope[];

beforeEach(() => {
  posted = [];
  configureCommandTransport({ postCommand: (envelope) => posted.push(envelope) });
});

afterEach(() => {
  configureCommandTransport(null);
});

async function fillAndSubmit() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Faction name"), "Aurelian League");
  await user.click(screen.getByRole("button", { name: "Launch New Galaxy" }));
}

describe("CreateFactionForm — success", () => {
  it("resets the store to no-world immediately on submit, then navigates to the map root once newGame succeeds", async () => {
    gameStore.applyStateFrame({ worldVersion: 5, slices: { visibility: { systemIds: ["sys-1"] } } });
    const onSuccess = vi.fn();
    const { navigate } = renderForm(onSuccess);

    await fillAndSubmit();

    // The swap-window reset (Proves 4) happens synchronously on dispatch, before any result lands.
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(gameStore.getSnapshot().worldVersion).toBe(0);
    expect(gameStore.getSnapshot().slices).toEqual({});
    expect(navigate).not.toHaveBeenCalled();

    deliverCommandResult({
      type: "commandResult",
      id: posted[0].id,
      result: { ok: true, data: { seed: 1, systemCount: 600, mapSize: 1000, currentTick: 0 } },
    });

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/"));
    expect(onSuccess).toHaveBeenCalled();
  });
});

describe("CreateFactionForm — failure", () => {
  it("shows the error and does not navigate", async () => {
    const { navigate } = renderForm();

    await fillAndSubmit();
    await waitFor(() => expect(posted).toHaveLength(1));

    deliverCommandResult({
      type: "commandResult",
      id: posted[0].id,
      result: { ok: false, error: "System count must be at least 50" },
    });

    expect(await screen.findByText("System count must be at least 50")).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });
});
