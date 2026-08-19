/**
 * Proves the router-agnostic link seam (`components/ui/link-provider.tsx`) actually drives
 * `Button` link-mode and `TabLink` through wouter when `client/wouter-link.tsx`'s adapter is
 * mounted — the shape the Vite shell (`client/main.tsx`) uses. Deliberately imports nothing from
 * `next/navigation` and mocks nothing from it: `TabLink`'s active-state and `Button`'s navigation
 * both have to work through wouter alone for this file to pass at all, which is the "without
 * next/navigation" half of Task 6's Proves entry.
 */
import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "wouter";
import { LinkProvider } from "@/components/ui/link-provider";
import { Button } from "@/components/ui/button";
import { TabLink } from "@/components/ui/tabs";
import { WouterLinkAdapter } from "../wouter-link";

afterEach(() => {
  window.history.pushState(null, "", "/");
});

function LocationProbe() {
  const [location] = useLocation();
  return <div data-testid="location">{location}</div>;
}

describe("the wouter link seam", () => {
  it("keeps TabLink's active state following the route as navigation happens", async () => {
    function TabsHarness() {
      const [location] = useLocation();
      return (
        <LinkProvider component={WouterLinkAdapter}>
          <TabLink href="/system/1/overview" active={location === "/system/1/overview"}>
            Overview
          </TabLink>
          <TabLink href="/system/1/market" active={location === "/system/1/market"}>
            Market
          </TabLink>
        </LinkProvider>
      );
    }

    window.history.pushState(null, "", "/system/1/market");
    render(<TabsHarness />);
    expect(screen.getByRole("link", { name: "Market" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Overview" })).not.toHaveAttribute("aria-current");

    const user = userEvent.setup();
    await user.click(screen.getByRole("link", { name: "Overview" }));

    expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Market" })).not.toHaveAttribute("aria-current");
  });

  it("navigates Button link-mode via wouter with the click's default prevented (no document reload)", async () => {
    window.history.pushState(null, "", "/");
    render(
      <LinkProvider component={WouterLinkAdapter}>
        <LocationProbe />
        <Button href="/start">Go to start</Button>
      </LinkProvider>,
    );

    const link = screen.getByRole("link", { name: "Go to start" });
    const notCancelled = fireEvent.click(link);

    // `dispatchEvent` returns `false` exactly when a listener called `preventDefault()` — the
    // signal that wouter's Link intercepted the click instead of letting the browser navigate.
    expect(notCancelled).toBe(false);
    expect(screen.getByTestId("location")).toHaveTextContent("/start");
    expect(window.location.pathname).toBe("/start");
  });
});
