import { afterEach, describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { gameStore, useGameSlice } from "../use-game-store";

function LivenessProbe() {
  const liveness = useGameSlice((state) => state.liveness);
  return (
    <div>
      <p>liveness: {liveness}</p>
      <button onClick={() => gameStore.setLiveness("live")}>go live</button>
    </div>
  );
}

// `gameStore` is a module-level singleton (one store for the whole app, by design — see
// `use-game-store.ts`'s docstring), so a test that mutates it via `setLiveness` must undo that
// mutation itself: there is no store-reset method on `GameStore` (only the three narrow
// apply/set actions, deliberately — see the `readonlyApi` fix), so isolation here means putting
// back only the field this file's test touches, not a full-state reset. Testing Library's own
// automatic cleanup (registered off `globals: true`) unmounts in a LIFO-ordered `afterEach`
// declared before this one, so this reset can still run against a mounted `LivenessProbe` —
// `act()` keeps that a wrapped update rather than a warning.
afterEach(() => {
  act(() => {
    gameStore.setLiveness("no-world");
  });
});

describe("useGameSlice", () => {
  it("re-renders with the store's current value when the store changes", async () => {
    const user = userEvent.setup();
    render(<LivenessProbe />);

    expect(screen.getByText(/liveness: no-world/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "go live" }));

    expect(screen.getByText(/liveness: live/)).toBeInTheDocument();
  });
});
