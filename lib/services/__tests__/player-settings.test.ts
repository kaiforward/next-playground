import { describe, it, expect, beforeEach } from "vitest";
import { setWorld, clearWorld, getWorld, getWorldVersion } from "@/lib/world/store";
import { generateWorld } from "@/lib/world/gen";
import { setAlertCategory, setTrackerSection } from "@/lib/services/player-settings";
import { DEFAULT_ALERT_CATEGORIES, DEFAULT_TRACKER_SECTIONS } from "@/lib/constants/attention";
import { ALERT_CATEGORY_IDS } from "@/lib/types/alerts";
import { seatWorld } from "./seat-world";

/** The seat world with no seat — the calibration harness's shape. The seat is what holds both
 *  settings records, so this is the shape every "no player" branch below is written against. */
function seatlessWorld() {
  return generateWorld({ systemCount: 60, seed: 42 });
}

describe("setAlertCategory", () => {
  beforeEach(() => {
    clearWorld();
    setWorld(seatWorld());
  });

  it("seeds a new world's categories from the authored defaults", () => {
    expect(getWorld().player?.alertCategories).toEqual(DEFAULT_ALERT_CATEGORIES);
  });

  it("turns a hideable category off and stores it on the player seat", () => {
    const result = setAlertCategory({ categoryId: "overcrowded", on: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.overcrowded).toBe(false);
    expect(getWorld().player?.alertCategories.overcrowded).toBe(false);
  });

  it("turns a default-off category on", () => {
    expect(DEFAULT_ALERT_CATEGORIES.unrest_rising).toBe(false);
    const result = setAlertCategory({ categoryId: "unrest_rising", on: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.unrest_rising).toBe(true);
    expect(getWorld().player?.alertCategories.unrest_rising).toBe(true);
  });

  it("returns the whole record, not just the flag written — the client replaces its copy with it", () => {
    const result = setAlertCategory({ categoryId: "overcrowded", on: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual({ ...DEFAULT_ALERT_CATEGORIES, overcrowded: false });
  });

  it("leaves every other category untouched", () => {
    setAlertCategory({ categoryId: "overcrowded", on: false });
    const stored = getWorld().player?.alertCategories;
    for (const id of ALERT_CATEGORY_IDS) {
      if (id === "overcrowded") continue;
      expect(stored?.[id], id).toBe(DEFAULT_ALERT_CATEGORIES[id]);
    }
  });

  // The tier cannot be turned off, and this is the boundary that enforces it — the settings panel
  // renders no control for a critical category, so anything reaching here is already ignoring the
  // registry. Answering 200 would tell that caller its change took.
  it("refuses to hide a critical category rather than accepting a write that does nothing", () => {
    const result = setAlertCategory({ categoryId: "population_collapse", on: false });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/critical/i);
    expect(getWorld().player?.alertCategories.population_collapse).toBe(true);
  });

  it("refuses to re-affirm a critical category as on, too — the flag is not the caller's to set", () => {
    const result = setAlertCategory({ categoryId: "maintenance_unfunded", on: true });
    expect(result.ok).toBe(false);
  });

  // The store's version counter is what tells every reader the world moved; a checkbox re-set to
  // what it already was must not fire that.
  it("skips the write when the flag already holds that value", () => {
    setAlertCategory({ categoryId: "overcrowded", on: false });
    const version = getWorldVersion();
    const result = setAlertCategory({ categoryId: "overcrowded", on: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.overcrowded).toBe(false);
    expect(getWorldVersion()).toBe(version);
  });

  it("errors rather than throwing on a world with no player seat", () => {
    setWorld(seatlessWorld());
    const result = setAlertCategory({ categoryId: "overcrowded", on: false });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/player seat/i);
  });

  it("errors rather than throwing with no world loaded at all", () => {
    clearWorld();
    const result = setAlertCategory({ categoryId: "overcrowded", on: false });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/no world/i);
  });
});

describe("setTrackerSection", () => {
  beforeEach(() => {
    clearWorld();
    setWorld(seatWorld());
  });

  it("seeds a new world's sections from the authored defaults", () => {
    expect(getWorld().player?.trackerSections).toEqual(DEFAULT_TRACKER_SECTIONS);
  });

  it("hides a section and stores it on the player seat", () => {
    const result = setTrackerSection({ section: "building", on: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual({ ...DEFAULT_TRACKER_SECTIONS, building: false });
    expect(getWorld().player?.trackerSections.building).toBe(false);
  });

  it("shows a hidden section again", () => {
    setTrackerSection({ section: "building", on: false });
    const result = setTrackerSection({ section: "building", on: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual(DEFAULT_TRACKER_SECTIONS);
  });

  // Unlike the alert bar, no section is protected — there is no critical tier here.
  it("allows every section to be hidden, including all three at once", () => {
    setTrackerSection({ section: "pinned", on: false });
    setTrackerSection({ section: "building", on: false });
    const result = setTrackerSection({ section: "colonising", on: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual({ pinned: false, building: false, colonising: false });
  });

  it("skips the write when the flag already holds that value", () => {
    const version = getWorldVersion();
    const result = setTrackerSection({ section: "building", on: true });
    expect(result.ok).toBe(true);
    expect(getWorldVersion()).toBe(version);
  });

  it("errors rather than throwing on a world with no player seat", () => {
    setWorld(seatlessWorld());
    const result = setTrackerSection({ section: "building", on: false });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/player seat/i);
  });
});

describe("the two records are independent", () => {
  beforeEach(() => {
    clearWorld();
    setWorld(seatWorld());
  });

  it("writing an alert category leaves the Tracker sections alone, and the reverse", () => {
    setAlertCategory({ categoryId: "overcrowded", on: false });
    expect(getWorld().player?.trackerSections).toEqual(DEFAULT_TRACKER_SECTIONS);
    setTrackerSection({ section: "building", on: false });
    expect(getWorld().player?.alertCategories).toEqual({
      ...DEFAULT_ALERT_CATEGORIES,
      overcrowded: false,
    });
  });

  // World-gen spreads both constants rather than referencing them; a world holding the module
  // constant itself would have every write mutate the default for every world in the process.
  it("does not mutate the shared default records when a world is written to", () => {
    setAlertCategory({ categoryId: "overcrowded", on: false });
    setTrackerSection({ section: "building", on: false });
    expect(DEFAULT_ALERT_CATEGORIES.overcrowded).toBe(true);
    expect(DEFAULT_TRACKER_SECTIONS.building).toBe(true);
  });
});
