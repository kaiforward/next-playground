import { describe, expect, it, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { LivenessBanner } from "../liveness-banner";
import { gameStore } from "@/lib/store/use-game-store";

// Proves 3 (client-runtime build plan Task 11): tickFailed shows cause and pause. Proves 2's UI
// half: a dead worker's liveness renders the reload offer (the store-level "commands reject" half
// is pinned in client/__tests__/worker-connection.test.ts). Plus the autosave-failure state §5/§11
// pagehide wiring feeds.

afterEach(() => {
  act(() => {
    gameStore.beginWorldReplacement();
  });
});

describe("LivenessBanner — live", () => {
  it("renders nothing when live with no standing failure", () => {
    act(() => {
      gameStore.setLiveness("live");
    });
    const { container } = render(<LivenessBanner />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("LivenessBanner — tickFailed pause", () => {
  it("shows the pause cause and a reload offer", () => {
    act(() => {
      gameStore.setTickFailed("processor threw: negative stock at system-24");
    });
    render(<LivenessBanner />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Game paused");
    expect(alert).toHaveTextContent("processor threw: negative stock at system-24");
    expect(screen.getByRole("button", { name: "Reload App" })).toBeInTheDocument();
  });
});

describe("LivenessBanner — dead worker", () => {
  it("shows a connection-lost message and a reload offer", () => {
    act(() => {
      gameStore.setLiveness("dead");
    });
    render(<LivenessBanner />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Connection to the game was lost");
    expect(screen.getByRole("button", { name: "Reload App" })).toBeInTheDocument();
  });

  it("takes priority over a standing tick-failure pause", () => {
    act(() => {
      gameStore.setTickFailed("processor threw");
      gameStore.setLiveness("dead");
    });
    render(<LivenessBanner />);

    expect(screen.getByRole("alert")).toHaveTextContent("Connection to the game was lost");
  });
});

describe("LivenessBanner — autosave failure", () => {
  it("shows the failure without a fake restore action", () => {
    act(() => {
      gameStore.setLiveness("live");
      gameStore.setAutosaveFailure("Node save backend unavailable in-browser");
    });
    render(<LivenessBanner />);

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Autosave failed");
    expect(status).toHaveTextContent("Node save backend unavailable in-browser");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
