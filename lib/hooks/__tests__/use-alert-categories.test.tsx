import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  useAlertCategories,
  DEFAULT_ALERT_CATEGORIES,
  type AlertCategorySettings,
} from "@/lib/hooks/use-alert-categories";

const STORAGE_KEY = "stellarTrader:alertCategories";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe("useAlertCategories — the three spec-named categories start unchecked on a first visit", () => {
  it("hydrates unrest_rising, build_blocked and industry_idle to false with no stored value at all", async () => {
    const { result } = renderHook(() => useAlertCategories());
    await act(async () => {});

    expect(result.current.categories.unrest_rising).toBe(false);
    expect(result.current.categories.build_blocked).toBe(false);
    expect(result.current.categories.industry_idle).toBe(false);
    // And every other category — including the critical tier — starts on, per the authored table.
    expect(result.current.categories.famine).toBe(true);
    expect(result.current.categories.deprived_worlds).toBe(true);
  });
});

describe("useAlertCategories — a malformed or partial stored value falls back to the authored defaults", () => {
  const cases: Array<[string, string]> = [
    ["invalid JSON", "{not json"],
    ["a JSON null", "null"],
    ["a JSON array", "[true, false, true]"],
    ["a bare string", '"unrest_rising"'],
    ["an object with only unrelated keys", JSON.stringify({ foo: "bar", pinned: true })],
    ["an object with a non-boolean value for a known key", JSON.stringify({ unrest_rising: "yes" })],
    ["an empty object (every key missing)", "{}"],
  ];

  it.each(cases)("%s hydrates to exactly DEFAULT_ALERT_CATEGORIES", async (_label, raw) => {
    window.localStorage.setItem(STORAGE_KEY, raw);

    const { result } = renderHook(() => useAlertCategories());
    await act(async () => {});

    // Pinned against the full authored table, not just an ON category — a fallback that landed on
    // "all on" instead of the authored defaults would still pass a check that only reads an ON
    // category (e.g. `famine`); reading the whole record catches it because `unrest_rising`,
    // `build_blocked` and `industry_idle` are authored OFF.
    expect(result.current.categories).toEqual(DEFAULT_ALERT_CATEGORIES);
    expect(result.current.categories.unrest_rising).toBe(false);
  });
});

describe("useAlertCategories — a partial stored value merges PER KEY onto the authored defaults", () => {
  it("honours a genuinely valid key while an invalid sibling key still falls back to its own default", async () => {
    // unrest_rising's own authored default is OFF — storing `true` for it, alongside a malformed
    // value for build_blocked, distinguishes a per-key merge from whole-object rejection: rejection
    // would discard the valid `unrest_rising: true` too, landing back on the full default record.
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ unrest_rising: true, build_blocked: "not-a-boolean" }),
    );

    const { result } = renderHook(() => useAlertCategories());
    await act(async () => {});

    expect(result.current.categories.unrest_rising).toBe(true);
    // build_blocked's own stored value was malformed — falls back to ITS authored default, not
    // dragged down by the sibling key's validity or up by the sibling key's own true value.
    expect(result.current.categories.build_blocked).toBe(false);
    // Every untouched key keeps its own authored default too.
    expect(result.current.categories.industry_idle).toBe(false);
    expect(result.current.categories.famine).toBe(true);
  });
});

describe("useAlertCategories — setCategory no-ops for a non-hideable (critical) category", () => {
  it("leaves famine true and writes nothing to storage when asked to turn it off", async () => {
    const { result } = renderHook(() => useAlertCategories());
    await act(async () => {});

    act(() => result.current.setCategory("famine", false));

    expect(result.current.categories.famine).toBe(true);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});

describe("useAlertCategories — the setting survives an unmount/remount, and the round trip preserves every key", () => {
  it("a hideable category turned off is still off after the hook's owner remounts", async () => {
    const first = renderHook(() => useAlertCategories());
    await act(async () => {});

    act(() => first.result.current.setCategory("deprived_worlds", false));
    expect(first.result.current.categories.deprived_worlds).toBe(false);

    first.unmount();

    const second = renderHook(() => useAlertCategories());
    await act(async () => {});

    expect(second.result.current.categories.deprived_worlds).toBe(false);
    // Every other category's own default survives the round trip untouched.
    expect(second.result.current.categories.unrest_rising).toBe(false);
    expect(second.result.current.categories.famine).toBe(true);
  });

  it("writing one key stores all sixteen, byte-for-byte, not just the one changed", async () => {
    const { result } = renderHook(() => useAlertCategories());
    await act(async () => {});

    act(() => result.current.setCategory("unrest_rising", true));

    const raw = window.localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed: AlertCategorySettings = JSON.parse(raw ?? "");
    expect(parsed).toEqual({ ...DEFAULT_ALERT_CATEGORIES, unrest_rising: true });
  });
});
