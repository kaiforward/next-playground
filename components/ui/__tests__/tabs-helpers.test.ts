import { describe, it, expect } from "vitest";
import { resolvePanelTabs, type PanelTabDef } from "@/components/ui/tabs-helpers";

// The real system-panel shape: an index tab plus sub-tabs, one of which ("market") is a prefix of
// a hypothetical sibling — the case that catches a bare `startsWith`.
const TABS: readonly PanelTabDef[] = [
  { label: "Overview", segment: "" },
  { label: "Industry", segment: "industry" },
  { label: "Market", segment: "market" },
  { label: "Market History", segment: "market-history" },
];

const BASE = "/system/sys-1";

function activeLabels(pathname: string): string[] {
  return resolvePanelTabs(BASE, TABS, pathname)
    .filter((tab) => tab.active)
    .map((tab) => tab.label);
}

describe("resolvePanelTabs", () => {
  it("links the index tab at the base path and every other tab one segment below it", () => {
    expect(resolvePanelTabs(BASE, TABS, BASE).map((tab) => tab.href)).toEqual([
      "/system/sys-1",
      "/system/sys-1/industry",
      "/system/sys-1/market",
      "/system/sys-1/market-history",
    ]);
  });

  it("carries each tab's label through unchanged", () => {
    expect(resolvePanelTabs(BASE, TABS, BASE).map((tab) => tab.label)).toEqual([
      "Overview",
      "Industry",
      "Market",
      "Market History",
    ]);
  });

  it("lights the index tab on the base path, and only there", () => {
    expect(activeLabels(BASE)).toEqual(["Overview"]);
  });

  it("does NOT light the index tab on a sub-tab's path", () => {
    // Every sub-tab href starts with the base path, so an index tab matched by prefix would stay
    // lit on all of them — two tabs current at once.
    expect(activeLabels(`${BASE}/industry`)).toEqual(["Industry"]);
  });

  it("lights a sub-tab on its own path", () => {
    expect(activeLabels(`${BASE}/market`)).toEqual(["Market"]);
  });

  it("keeps a sub-tab lit on a route nested under it", () => {
    expect(activeLabels(`${BASE}/industry/refinery-3`)).toEqual(["Industry"]);
  });

  it("does not let a sub-tab light a sibling whose segment merely starts with the same letters", () => {
    expect(activeLabels(`${BASE}/market-history`)).toEqual(["Market History"]);
  });

  it("lights nothing when the pathname belongs to another panel entirely", () => {
    expect(activeLabels("/factions/faction-1")).toEqual([]);
  });

  it("returns an empty list for an empty tab list", () => {
    expect(resolvePanelTabs(BASE, [], BASE)).toEqual([]);
  });
});
