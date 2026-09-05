import { describe, it, expect } from "vitest";
import { parseRoute, laneHref, systemHref, factionHref } from "../route-hrefs";

describe("parseRoute — the inverse of the href builders", () => {
  it("round-trips a lane href, decoding the key's `|`", () => {
    expect(parseRoute(laneHref("sys-a|sys-b"))).toEqual({ name: "lane", laneKey: "sys-a|sys-b" });
  });

  it("reads the bare system and faction paths as the Overview tab, and a segment as that tab", () => {
    expect(parseRoute(systemHref("s1", ""))).toEqual({ name: "system", systemId: "s1", tab: "" });
    expect(parseRoute(systemHref("s1", "industry"))).toEqual({ name: "system", systemId: "s1", tab: "industry" });
    expect(parseRoute(factionHref("f1", "territory"))).toEqual({ name: "faction", factionId: "f1", tab: "territory" });
  });

  it("falls through to the map root for the root and for anything unrecognised", () => {
    expect(parseRoute("/")).toEqual({ name: "map" });
    expect(parseRoute("/nothing/here")).toEqual({ name: "map" });
    expect(parseRoute("/start")).toEqual({ name: "start" });
    expect(parseRoute("/styleguide")).toEqual({ name: "styleguide" });
  });
});
