import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RadioGroup } from "@/components/form/radio-group";
import { SegmentedControl } from "@/components/form/segmented-control";

/**
 * `RadioGroup` and `SegmentedControl` are two skins over one behaviour (`RadioOptionGroup`), so the
 * semantics they share are asserted against both: a real `radiogroup` named either by its visible
 * heading or by `ariaLabel`, native radios carrying the option text as their accessible name, and a
 * click reporting the option's value. Styling is the only thing a skin is allowed to differ in — if a
 * skin ever stopped rendering radios, only these catch it.
 */
const skins = [
  { name: "RadioGroup", Control: RadioGroup },
  { name: "SegmentedControl", Control: SegmentedControl },
] as const;

const options = [
  { value: "buy", label: "Buy" },
  { value: "sell", label: "Sell" },
] as const;

describe.each(skins)("$name — shared single-select semantics", ({ Control }) => {
  it("names the group by its visible heading", () => {
    render(
      <Control
        label="Side"
        name="side"
        value="buy"
        onChange={vi.fn()}
        options={options}
      />,
    );

    expect(screen.getByRole("radiogroup", { name: "Side" })).toBeInTheDocument();
    expect(screen.getByText("Side")).toBeInTheDocument();
  });

  it("falls back to ariaLabel when no visible heading is rendered", () => {
    render(
      <Control
        ariaLabel="Side"
        name="side"
        value="buy"
        onChange={vi.fn()}
        options={options}
      />,
    );

    expect(screen.getByRole("radiogroup", { name: "Side" })).toBeInTheDocument();
    expect(screen.queryByText("Side")).not.toBeInTheDocument();
  });

  it("renders one radio per option and marks the selected one checked", () => {
    render(
      <Control
        ariaLabel="Side"
        name="side"
        value="sell"
        onChange={vi.fn()}
        options={options}
      />,
    );

    expect(screen.getByRole("radio", { name: "Buy" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "Sell" })).toBeChecked();
  });

  it("reports the clicked option's value", async () => {
    const onChange = vi.fn();
    render(
      <Control
        ariaLabel="Side"
        name="side"
        value="buy"
        onChange={onChange}
        options={options}
      />,
    );

    await userEvent.click(screen.getByRole("radio", { name: "Sell" }));

    expect(onChange).toHaveBeenCalledWith("sell");
  });
});
