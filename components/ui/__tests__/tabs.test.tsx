import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { TabLink } from "../tabs";

describe("TabLink", () => {
  it("marks the active tab as the current page", () => {
    render(
      <>
        <TabLink href="/system/1" active>
          Overview
        </TabLink>
        <TabLink href="/system/1/market" active={false}>
          Market
        </TabLink>
      </>,
    );

    // Which tab you are on has to reach a screen reader, not only the eye — the
    // active state is otherwise carried by colour alone.
    expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Market" })).not.toHaveAttribute("aria-current");
  });
});
