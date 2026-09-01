import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CreateFactionForm } from "../create-faction-form";
import { NavigateProvider } from "@/components/ui/link-provider";
import { gameStore } from "@/lib/store/use-game-store";
import {
  configureCommandTransport,
  deliverCommandResult,
  type AnyCommandEnvelope,
} from "@/lib/runtime/command-client";

// Proves 1's client half: new game from a live game lands on
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

let posted: AnyCommandEnvelope[];

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
    gameStore.applyStateFrame({ frameSeq: 1, worldVersion: 5, slices: { visibility: { systemIds: ["sys-1"] } } });
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

describe("CreateFactionForm — galaxy shape knobs", () => {
  it("renders every shape knob with an accessible name, plus the embedded preview", () => {
    renderForm();

    expect(screen.getByLabelText("Cluster count")).toBeInTheDocument();
    expect(screen.getByLabelText("Size skew")).toBeInTheDocument();
    expect(screen.getByLabelText("Cluster spacing")).toBeInTheDocument();
    expect(screen.getByLabelText("Void floor")).toBeInTheDocument();
    expect(screen.getByLabelText("Corridors per cluster")).toBeInTheDocument();
    expect(screen.getByLabelText("Cluster turbulence")).toBeInTheDocument();
    expect(screen.getByLabelText("Star spacing")).toBeInTheDocument();
    expect(screen.getByLabelText("Cluster tightness")).toBeInTheDocument();
    expect(screen.getByLabelText("Map size")).toBeInTheDocument();
    expect(screen.getByText("Corridor style")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Mixed" })).toBeChecked();
    expect(screen.getByRole("img", { name: "Galaxy generation preview" })).toBeInTheDocument();
  });

  it("submits the exact knob values shown, once a knob is changed — the previewed values are the played ones", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText("Faction name"), "Aurelian League");
    const clusterCount = screen.getByLabelText("Cluster count");
    await user.clear(clusterCount);
    await user.type(clusterCount, "12");
    await user.click(screen.getByRole("radio", { name: "Mostly crossings" }));

    await user.click(screen.getByRole("button", { name: "Launch New Galaxy" }));

    await waitFor(() => expect(posted).toHaveLength(1));
    const payload = posted[0].payload as { shape?: { clusterCount?: number; corridorStyle?: number } };
    expect(payload.shape?.clusterCount).toBe(12);
    expect(payload.shape?.corridorStyle).toBe(0.85);
  });

  it("submits the Gate-A default shape values unchanged when no knob is touched", async () => {
    renderForm();

    await fillAndSubmit();
    await waitFor(() => expect(posted).toHaveLength(1));

    const payload = posted[0].payload as {
      shape?: { clusterCount: number; starSpacing: number; clusterTightness: number; mapSizeScale: number };
    };
    expect(payload.shape).toBeDefined();
    expect(payload.shape?.starSpacing).toBe(1);
    expect(payload.shape?.clusterTightness).toBe(0.05);
    expect(payload.shape?.mapSizeScale).toBe(1);
  });

  it("opens with a concrete seed pre-filled and submits exactly that seed untouched — the previewed galaxy is the played one", async () => {
    renderForm();

    const seedInput = screen.getByLabelText("Seed", { exact: true });
    const shown = Number((seedInput as HTMLInputElement).value);
    expect(Number.isInteger(shown)).toBe(true);

    await fillAndSubmit();
    await waitFor(() => expect(posted).toHaveLength(1));

    const payload = posted[0].payload as { seed?: number };
    expect(payload.seed).toBe(shown);
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
