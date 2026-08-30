import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DevToolsPanel } from "../dev-tools-panel";

// The dev event spawner vertical is removed — the panel offers only the tabs that survive
// the strip. Pins the tab list rather than the deleted section's own markup, since the deleted
// section is gone from the tree entirely once its tab is gone.

describe("DevToolsPanel", () => {
  it("renders Tick, Economy and Map tabs but no Events tab", async () => {
    const user = userEvent.setup();
    render(<DevToolsPanel />);

    await user.click(screen.getByTitle("Dev Tools"));

    expect(screen.getByRole("button", { name: "Tick" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Economy" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Map" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Events" })).not.toBeInTheDocument();
  });
});
