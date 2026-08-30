import { describe, it, expect } from "vitest";
import { DEFAULT_ALERT_CATEGORIES, DEFAULT_TRACKER_SECTIONS } from "../attention";
import { ALERT_CATEGORIES } from "../alerts";
import { ALERT_CATEGORY_IDS } from "@/lib/types/alerts";
import { TRACKER_SECTION_KEYS } from "@/lib/types/tracker";

describe("DEFAULT_ALERT_CATEGORIES — the authored defaults table", () => {
  // Independently named from the spec's defaults table, not read back off the record under test — a
  // test that only reflects the object at itself proves nothing.
  const EXPECTED_OFF = new Set(["unrest_rising", "industry_idle", "build_blocked"]);

  it("defaults exactly the three named important categories off", () => {
    for (const id of ALERT_CATEGORY_IDS) {
      expect(DEFAULT_ALERT_CATEGORIES[id], id).toBe(!EXPECTED_OFF.has(id));
    }
  });

  // The compiler already requires all thirteen keys; this catches the other direction — a key left
  // behind after a category is renamed or dropped from `ALERT_CATEGORY_IDS`.
  it("carries exactly the thirteen category ids and no more", () => {
    expect(Object.keys(DEFAULT_ALERT_CATEGORIES).sort()).toEqual([...ALERT_CATEGORY_IDS].sort());
  });

  // The registry no longer states a default of its own, so the invariant that used to be local to
  // one row ("a critical category is on, because the tier can't be turned off") now spans two files
  // and is only true if this record agrees with `hideable`.
  it("defaults every non-hideable category on, so the critical tier can never start hidden", () => {
    for (const id of ALERT_CATEGORY_IDS) {
      if (ALERT_CATEGORIES[id].hideable) continue;
      expect(DEFAULT_ALERT_CATEGORIES[id], id).toBe(true);
    }
  });
});

describe("DEFAULT_TRACKER_SECTIONS — every section starts visible", () => {
  it("defaults all three sections on", () => {
    for (const key of TRACKER_SECTION_KEYS) {
      expect(DEFAULT_TRACKER_SECTIONS[key], key).toBe(true);
    }
  });

  it("carries exactly the three section keys and no more", () => {
    expect(Object.keys(DEFAULT_TRACKER_SECTIONS).sort()).toEqual([...TRACKER_SECTION_KEYS].sort());
  });
});
