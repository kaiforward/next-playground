import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { useSystemValueMap } from "@/lib/hooks/use-system-value-map";
import { useStability } from "@/lib/hooks/use-stability";
import { seedSlices } from "./store-fixture";
import type { StabilityEntry } from "@/lib/types/game";
import type { StoreState } from "@/lib/store/game-store";

const pickUnrest = (e: StabilityEntry) => e.unrest;
const selectStability = (state: StoreState) => state.slices.stability;

/** Renders the map's entries as `id=value` pairs so an emptied map is observable as empty text. */
function Probe({ active }: { active: boolean }) {
  const values = useSystemValueMap(selectStability, pickUnrest, active);
  return (
    <div data-testid="values">
      {[...values].map(([id, v]) => `${id}=${v}`).join(",")}
    </div>
  );
}

function StabilityProbe({ active }: { active: boolean }) {
  const values = useStability(active);
  return <div data-testid="values">{[...values].map(([id, v]) => `${id}=${v}`).join(",")}</div>;
}

describe("useSystemValueMap", () => {
  it("empties the map when inactive even though the slice still holds the last data", () => {
    // The teardown contract: an inactive caller must read empty, not the last mode's cached fill.
    // The slice itself is not re-seeded between renders, so a hook that reduced it without
    // consulting `active` would still report the entries here.
    seedSlices({ stability: [{ systemId: "sys-1", unrest: 0.4 }] });

    const { rerender } = render(<Probe active />);
    expect(screen.getByTestId("values")).toHaveTextContent("sys-1=0.4");

    rerender(<Probe active={false} />);

    // `toHaveTextContent("")` matches anything — assert the raw text instead.
    expect(screen.getByTestId("values").textContent).toBe("");
  });

  it("keys the map by systemId and reads the value through the caller's accessor", () => {
    // useStability picks `unrest`; a hook wired to the wrong field would render `undefined` here.
    seedSlices({
      stability: [
        { systemId: "sys-1", unrest: 0.25 },
        { systemId: "sys-2", unrest: 0.75 },
      ],
    });

    render(<StabilityProbe active />);

    expect(screen.getByTestId("values")).toHaveTextContent("sys-1=0.25,sys-2=0.75");
  });
});
