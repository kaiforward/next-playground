import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdvanceTicksSection } from "../advance-ticks-section";
import {
  configureCommandTransport,
  deliverCommandResult,
  type AnyCommandEnvelope,
} from "@/lib/runtime/command-client";

// Review finding 1 (Task 13): `inspectWorld` was protocol-wired with no reachable caller — a
// developer had to write code to invoke it. This pins the affordance: the button dispatches the
// `inspectWorld` command and the result reaches the console (spec §10: "exposing the current
// snapshot" for console inspection).

let posted: AnyCommandEnvelope[];

beforeEach(() => {
  posted = [];
  configureCommandTransport({ postCommand: (envelope) => posted.push(envelope) });
});

afterEach(() => {
  configureCommandTransport(null);
  vi.restoreAllMocks();
});

describe("AdvanceTicksSection — Inspect World affordance", () => {
  it("dispatches the inspectWorld command and logs the result to the console", async () => {
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const user = userEvent.setup();
    render(<AdvanceTicksSection />);

    await user.click(screen.getByRole("button", { name: "Inspect World (console)" }));

    expect(posted).toHaveLength(1);
    expect(posted[0].type).toBe("inspectWorld");

    const inspection = {
      meta: { seed: 1, systemCount: 10, mapSize: 100, currentTick: 42 },
      counts: {
        regions: 1, systems: 10, bodies: 0, buildings: 0, constructionProjects: 0, connections: 0,
        markets: 0, factions: 1, relations: 0, alliancePacts: 0, treasuries: 1, events: 0,
        modifiers: 0, ships: 0, flowEvents: 0,
      },
      nextId: 1,
    };
    deliverCommandResult({ type: "commandResult", id: posted[0].id, result: { ok: true, data: inspection } });

    expect(await screen.findByText(/Tick 42 — 10 systems, logged to console/)).toBeInTheDocument();
    expect(consoleLog).toHaveBeenCalledWith("[dev-tools] inspectWorld:", inspection);
  });

  it("surfaces a rejected inspectWorld command's error instead of logging silently", async () => {
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const user = userEvent.setup();
    render(<AdvanceTicksSection />);

    await user.click(screen.getByRole("button", { name: "Inspect World (console)" }));
    deliverCommandResult({
      type: "commandResult",
      id: posted[0].id,
      result: { ok: false, error: "No world loaded." },
    });

    expect(await screen.findByText("No world loaded.")).toBeInTheDocument();
    expect(consoleLog).not.toHaveBeenCalled();
  });
});
