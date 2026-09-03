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
import { defaultGalaxyShapeKnobs } from "@/lib/engine/density-field";
import type { NewGameInput } from "@/lib/schemas/game-setup";

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

/** The `newGame` payload off a posted envelope, narrowed on the envelope's own `type` discriminant
 *  rather than cast — every other command carries a different payload shape. */
function newGamePayload(envelope: AnyCommandEnvelope): NewGameInput {
  if (envelope.type !== "newGame") throw new Error(`expected a newGame command, got ${envelope.type}`);
  return envelope.payload;
}

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

describe("CreateFactionForm — full-screen chrome", () => {
  it("calls onCancel from both the top-bar Back control and the floating Cancel button, without submitting", async () => {
    const onCancel = vi.fn();
    render(
      <NavigateProvider navigate={vi.fn()}>
        <CreateFactionForm onCancel={onCancel} />
      </NavigateProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(posted).toHaveLength(0);
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
    const payload = newGamePayload(posted[0]);
    expect(payload.shape?.clusterCount).toBe(12);
    expect(payload.shape?.corridorStyle).toBe(0.85);
  });

  it("submits the Gate-A default shape values unchanged when no knob is touched", async () => {
    renderForm();

    await fillAndSubmit();
    await waitFor(() => expect(posted).toHaveLength(1));

    const payload = newGamePayload(posted[0]);
    const engineDefaults = defaultGalaxyShapeKnobs(600);
    expect(payload.shape).toBeDefined();
    expect(payload.shape?.clusterCount).toBe(engineDefaults.clusterCount);
    expect(payload.shape?.clusterSpacing).toBe(engineDefaults.clusterSpacing);
    expect(payload.shape?.starSpacing).toBe(1);
    expect(payload.shape?.clusterTightness).toBe(0.05);
    expect(payload.shape?.mapSizeScale).toBe(1);
  });

  // The engine scales cluster count and spacing by sqrt(N). A frozen default set would submit a
  // 600-system galaxy's structure whatever size the player picked, and the engine's own
  // `?? config.X` fallbacks would never fire because the form always sends every knob.
  it("re-derives the untouched shape defaults from the system count — a 10,000-system galaxy submits the scaled values, not the 600-system ones", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText("Faction name"), "Aurelian League");
    const systemCount = screen.getByLabelText("Systems");
    await user.clear(systemCount);
    await user.type(systemCount, "10000");
    await user.click(screen.getByRole("button", { name: "Launch New Galaxy" }));

    await waitFor(() => expect(posted).toHaveLength(1));
    const scaled = defaultGalaxyShapeKnobs(10_000);
    const frozen = defaultGalaxyShapeKnobs(600);
    expect(scaled.clusterCount).not.toBe(frozen.clusterCount); // non-vacuous: the scale really moves
    expect(newGamePayload(posted[0]).shape?.clusterCount).toBe(scaled.clusterCount);
    expect(newGamePayload(posted[0]).shape?.clusterSpacing).toBe(scaled.clusterSpacing);
  });

  it("leaves a knob the player edited alone when the system count changes, while still rescaling the untouched ones", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText("Faction name"), "Aurelian League");
    const clusterCount = screen.getByLabelText("Cluster count");
    await user.clear(clusterCount);
    await user.type(clusterCount, "12");

    const systemCount = screen.getByLabelText("Systems");
    await user.clear(systemCount);
    await user.type(systemCount, "10000");
    await user.click(screen.getByRole("button", { name: "Launch New Galaxy" }));

    await waitFor(() => expect(posted).toHaveLength(1));
    const payload = newGamePayload(posted[0]);
    expect(payload.shape?.clusterCount).toBe(12);
    expect(payload.shape?.clusterSpacing).toBe(defaultGalaxyShapeKnobs(10_000).clusterSpacing);
  });

  it("rerolls the seed via the seed chip's reroll button and submits the rerolled value", async () => {
    const user = userEvent.setup();
    renderForm();

    const seedInput = screen.getByRole<HTMLInputElement>("textbox", { name: "Seed" });
    const initial = Number(seedInput.value);
    await user.type(screen.getByLabelText("Faction name"), "Aurelian League");
    await user.click(screen.getByRole("button", { name: "Reroll" }));
    const rerolled = Number(seedInput.value);

    // Non-vacuous: the reroll must actually change the displayed value (astronomically unlikely
    // to collide — 1 in 1,000,000 — so a real change is what this asserts, not a lucky repeat).
    expect(rerolled).not.toBe(initial);

    await user.click(screen.getByRole("button", { name: "Launch New Galaxy" }));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(newGamePayload(posted[0]).seed).toBe(rerolled);
  });

  it("opens with a concrete seed pre-filled and submits exactly that seed untouched — the previewed galaxy is the played one", async () => {
    renderForm();

    // Typed through the query's own element parameter, not a cast.
    const seedInput = screen.getByRole<HTMLInputElement>("textbox", { name: "Seed" });
    const shown = Number(seedInput.value);
    expect(Number.isInteger(shown)).toBe(true);
    expect(shown).toBeGreaterThan(0);

    await fillAndSubmit();
    await waitFor(() => expect(posted).toHaveLength(1));

    expect(newGamePayload(posted[0]).seed).toBe(shown);
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
