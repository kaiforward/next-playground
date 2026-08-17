import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TrackerSettings } from "@/components/tracker/tracker-settings";
import type { TrackerSections } from "@/lib/types/tracker";

const ALL_ON: TrackerSections = { pinned: true, building: true, colonising: true };

describe("TrackerSettings — one checkbox per section, reflecting the current state", () => {
  it("renders Pinned, Building and Colonising, each checked when its section is on", () => {
    render(<TrackerSettings sections={ALL_ON} onChangeSection={vi.fn()} />);

    expect(screen.getByRole("checkbox", { name: "Pinned" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Building" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Colonising" })).toBeChecked();
  });

  it("a section turned off in props renders its checkbox unchecked, not just the other two checked", () => {
    render(
      <TrackerSettings
        sections={{ pinned: true, building: false, colonising: true }}
        onChangeSection={vi.fn()}
      />,
    );

    expect(screen.getByRole("checkbox", { name: "Building" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Pinned" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Colonising" })).toBeChecked();
  });
});

describe("TrackerSettings — unticking a checkbox reports the section and the OFF direction", () => {
  it("clicking a checked Building checkbox calls onChangeSection('building', false)", async () => {
    const user = userEvent.setup();
    const onChangeSection = vi.fn();
    render(<TrackerSettings sections={ALL_ON} onChangeSection={onChangeSection} />);

    await user.click(screen.getByRole("checkbox", { name: "Building" }));

    expect(onChangeSection).toHaveBeenCalledExactlyOnceWith("building", false);
  });
});
