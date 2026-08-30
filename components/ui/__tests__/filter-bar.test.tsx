import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FilterBar } from "@/components/ui/filter-bar";

const SORT_OPTIONS = [
  { id: "a", label: "Option A" },
  { id: "b", label: "Option B" },
];

describe("FilterBar — chips are optional", () => {
  it("renders the sort control and result count with no chip row when chips are omitted", () => {
    render(
      <FilterBar
        sortOptions={SORT_OPTIONS}
        activeSort="a"
        onSortChange={vi.fn()}
        resultCount={{ shown: 2, total: 5 }}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Sort by" })).toBeInTheDocument();
    expect(screen.getByText("2 of 5")).toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("renders a chip-passing caller exactly as today — chip buttons toggle on click", async () => {
    const user = userEvent.setup();
    const onChipToggle = vi.fn();
    render(
      <FilterBar
        chipFilter={{
          chips: [
            { id: "all", label: "All", count: 5 },
            { id: "dominant", label: "Dominant", count: 2 },
          ],
          activeChips: ["all"],
          onChipToggle,
        }}
        sortOptions={SORT_OPTIONS}
        activeSort="a"
        onSortChange={vi.fn()}
        resultCount={{ shown: 5, total: 5 }}
      />,
    );

    const dominantChip = screen.getByRole("button", { name: /Dominant/ });
    expect(dominantChip).toBeInTheDocument();
    await user.click(dominantChip);
    expect(onChipToggle).toHaveBeenCalledWith("dominant");
  });
});
