import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { GhostVitalTile, VitalGrid, VitalTile } from "@/components/ui/vital-tile";
import { CompositionBar } from "@/components/ui/composition-bar";

// Rendered in jsdom and queried the way a user or a screen reader finds things — by role, by
// accessible name, by text. What a tile *shows* is asserted through its text content and the
// meter's aria value, not through the inline width and colour that carry it: those come off the
// same `pct` and `color` props the aria value does, so asserting them only restates the props.

describe("VitalTile — the three concrete Overview tiles render their real output", () => {
  it("Stability: value + unit + a meter carrying 82% with progressbar a11y", () => {
    const { container } = render(
      <VitalTile
        label="Stability"
        dotColor="#06b6d4"
        value="82"
        unit="%"
        meter={{ pct: 82, color: "#06b6d4" }}
        hint="unrest 0.18"
      />,
    );
    expect(screen.getByText("Stability")).toBeInTheDocument();
    expect(container).toHaveTextContent("82%"); // value and unit, adjacent as displayed
    const meter = screen.getByRole("progressbar", { name: "Stability: 82%" });
    expect(meter).toHaveAttribute("aria-valuenow", "82");
    expect(meter).toHaveAttribute("aria-valuemin", "0");
    expect(meter).toHaveAttribute("aria-valuemax", "100");
    expect(screen.getByText("unrest 0.18")).toBeInTheDocument();
  });

  it("Development: the same shape at a different value", () => {
    const { container } = render(
      <VitalTile
        label="Development"
        dotColor="var(--color-accent)"
        value="41"
        unit="%"
        meter={{ pct: 41, color: "var(--color-accent)" }}
        hint="118 pts · room to grow"
      />,
    );
    // Asserted on the DOM, not only on the meter's accessible name: that name is built from the
    // props, so it still reads "41%" even if the unit never renders.
    expect(container).toHaveTextContent("41%");
    expect(screen.getByRole("progressbar", { name: "Development: 41%" })).toHaveAttribute(
      "aria-valuenow",
      "41",
    );
    expect(screen.getByText("118 pts · room to grow")).toBeInTheDocument();
  });

  it("rounds a fractional meter value for the a11y reading", () => {
    // The one derivation on this path: the fill takes the raw pct, the announced value is rounded.
    render(
      <VitalTile
        label="Stability"
        dotColor="#06b6d4"
        value="82"
        unit="%"
        meter={{ pct: 82.4, color: "#06b6d4" }}
      />,
    );
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "82");
  });

  it("Population: value + a CompositionBar child, and NO meter", () => {
    const { container } = render(
      <VitalTile
        label="Population"
        dotColor="var(--color-status-blue)"
        value="2.42"
        unit="M"
      >
        <CompositionBar
          segments={[
            { label: "Unsk", value: 61, color: "var(--color-status-blue)" },
            { label: "Tech", value: 22, color: "var(--color-status-cyan)" },
            { label: "Eng", value: 9, color: "var(--color-status-purple)" },
            { label: "Unemployed", value: 8, color: "var(--color-surface-active)" },
          ]}
        />
      </VitalTile>,
    );
    expect(container).toHaveTextContent("2.42M");
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument(); // no meter on this tile
    // The composition percentages, as the bar announces them (61/22/9/8 sum to 100).
    expect(
      screen.getByRole("img", { name: "Composition: Unsk 61%, Tech 22%, Eng 9%, Unemployed 8%" }),
    ).toBeInTheDocument();
    expect(container).toHaveTextContent("Unsk 61%"); // legend
  });

  it("Provisioned: a markerPct draws a second tick on the meter, independent of the fill", () => {
    const { container } = render(
      <VitalTile
        label="Provisioned"
        dotColor="#64748b"
        value="68"
        unit="%"
        meter={{ pct: 68, color: "#64748b", markerPct: 84 }}
      />,
    );
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "68");
    // The marker is decorative (aria-hidden), so the only thing a DOM test can honestly say
    // about it is whether it renders at all — its position is a style.
    expect(container.querySelector(".border-dashed")).not.toBeNull();
  });

  it("a ReactNode label (a term trigger wrapping plain text) still reads as plain text in the meter's accessible name", () => {
    render(
      <VitalTile
        label={<button type="button">Stability</button>}
        dotColor="#06b6d4"
        value="82"
        unit="%"
        meter={{ pct: 82, color: "#06b6d4" }}
      />,
    );
    // The visible label renders whatever was passed (here a real button)…
    expect(screen.getByRole("button", { name: "Stability" })).toBeInTheDocument();
    // …but the meter's own accessible name flattens it to plain text rather than stringifying the element.
    expect(screen.getByRole("progressbar", { name: "Stability: 82%" })).toBeInTheDocument();
  });

  it("omitting markerPct draws no second tick — the four existing callers are unaffected", () => {
    const { container } = render(
      <VitalTile
        label="Stability"
        dotColor="#06b6d4"
        value="82"
        unit="%"
        meter={{ pct: 82, color: "#06b6d4" }}
      />,
    );
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(container.querySelector(".border-dashed")).toBeNull();
  });
});

describe("GhostVitalTile — dashed future-slot placeholder", () => {
  it("renders the label and the future-slot names", () => {
    render(
      <GhostVitalTile label="Future vitals" future="control · treasury · tax base · logistics" />,
    );
    expect(screen.getByText("Future vitals")).toBeInTheDocument();
    expect(screen.getByText("control · treasury · tax base · logistics")).toBeInTheDocument();
  });
});

describe("VitalGrid — N-up wrapper", () => {
  it("renders its tile children", () => {
    render(
      <VitalGrid>
        <VitalTile label="Stability" dotColor="#06b6d4" value="82" unit="%" />
        <GhostVitalTile label="Future vitals" future="control · treasury" />
      </VitalGrid>,
    );
    expect(screen.getByText("Stability")).toBeInTheDocument();
    expect(screen.getByText("Future vitals")).toBeInTheDocument();
  });
});
