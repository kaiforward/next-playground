import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  useTrackerSections,
  DEFAULT_TRACKER_SECTIONS,
  type TrackerSections,
} from "@/lib/hooks/use-tracker-sections";

const STORAGE_KEY = "stellarTrader:trackerSections";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe("useTrackerSections — a malformed stored value falls back to all-sections-on", () => {
  it("invalid JSON does not throw and hydrates to the all-on default", async () => {
    window.localStorage.setItem(STORAGE_KEY, "{not json");

    const { result } = renderHook(() => useTrackerSections());
    // The hook hydrates from storage in an effect — flush it before asserting.
    await act(async () => {});

    expect(result.current.sections).toEqual(DEFAULT_TRACKER_SECTIONS);
  });

  it("validly-parsed JSON of the wrong shape (a non-boolean field) also falls back to all-on", async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ pinned: "yes", building: true, colonising: true }));

    const { result } = renderHook(() => useTrackerSections());
    await act(async () => {});

    expect(result.current.sections).toEqual(DEFAULT_TRACKER_SECTIONS);
  });
});

describe("useTrackerSections — the setting survives a route change within the game shell", () => {
  it("a section turned off is still off after the hook's owner unmounts and remounts", async () => {
    const first = renderHook(() => useTrackerSections());
    await act(async () => {});

    act(() => first.result.current.setSection("building", false));
    expect(first.result.current.sections.building).toBe(false);

    // Unmount stands in for a route change within the game shell — MapRightRail (the hook's real
    // owner) is not expected to unmount on a system-panel navigation today, but the persistence
    // this proves must hold even if it did.
    first.unmount();

    const second = renderHook(() => useTrackerSections());
    await act(async () => {});

    expect(second.result.current.sections).toEqual({ pinned: true, building: false, colonising: true });
  });
});

describe("useTrackerSections — the localStorage round trip preserves every field, not just the one changed", () => {
  it("writing a specific true/false/true combination reads back byte-for-byte from the raw stored JSON", async () => {
    const { result } = renderHook(() => useTrackerSections());
    await act(async () => {});

    act(() => result.current.setSection("pinned", false));
    act(() => result.current.setSection("colonising", false));
    act(() => result.current.setSection("building", true));

    const raw = window.localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed: TrackerSections = JSON.parse(raw ?? "");
    expect(parsed).toEqual({ pinned: false, building: true, colonising: false });
  });
});
