"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "stellarTrader:trackerSections";

export type TrackerSectionKey = "pinned" | "building" | "colonising";

export type TrackerSections = Record<TrackerSectionKey, boolean>;

/**
 * Default AND fallback: every section on. A Tracker section carries no urgency (unlike the alert
 * bar), so defaulting to "show everything" — including whenever the stored value can't be
 * trusted — loses the player nothing (docs/active/gameplay/tracker.md → "Settings").
 */
export const DEFAULT_TRACKER_SECTIONS: TrackerSections = {
  pinned: true,
  building: true,
  colonising: true,
};

/**
 * Narrows a parsed `localStorage` value at the boundary — `typeof`/`in` checks only, no `as`,
 * mirroring `components/map/map-session.ts`'s `parseOverlays`. Anything that isn't all three
 * known keys, each a boolean, is malformed and the caller falls back to
 * `DEFAULT_TRACKER_SECTIONS`.
 */
function parseSections(value: unknown): TrackerSections | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  if (
    "pinned" in value && typeof value.pinned === "boolean" &&
    "building" in value && typeof value.building === "boolean" &&
    "colonising" in value && typeof value.colonising === "boolean"
  ) {
    return { pinned: value.pinned, building: value.building, colonising: value.colonising };
  }
  return undefined;
}

function readStoredSections(): TrackerSections {
  if (typeof window === "undefined") return DEFAULT_TRACKER_SECTIONS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_TRACKER_SECTIONS;
    const parsed: unknown = JSON.parse(raw);
    return parseSections(parsed) ?? DEFAULT_TRACKER_SECTIONS;
  } catch {
    // Malformed JSON, or `localStorage` unavailable (SSR / privacy mode) — fall back rather than
    // throw at the boundary.
    return DEFAULT_TRACKER_SECTIONS;
  }
}

function writeStoredSections(sections: TrackerSections): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sections));
  } catch {
    // Storage unavailable or full — the change stays in-memory for this render only.
  }
}

/**
 * Which Tracker sections the player wants to see — a view preference, not world state (never
 * part of the save; docs/active/gameplay/tracker.md → "Settings"). Persisted to `localStorage`, not
 * `sessionStorage`: hiding a section is a "not interested in this" preference the player expects
 * to hold tomorrow, not something that resets when the tab closes.
 *
 * Hydrates from storage in an effect rather than on the initial render, matching
 * `useMapOverlays`' own client-storage pattern — a server-rendered first paint and the client's
 * first paint agree (both see `DEFAULT_TRACKER_SECTIONS`) before the real stored value lands.
 */
export function useTrackerSections(): {
  sections: TrackerSections;
  setSection: (key: TrackerSectionKey, on: boolean) => void;
} {
  const [sections, setSections] = useState<TrackerSections>(DEFAULT_TRACKER_SECTIONS);

  useEffect(() => {
    setSections(readStoredSections());
  }, []);

  const setSection = useCallback((key: TrackerSectionKey, on: boolean) => {
    setSections((prev) => {
      const next = { ...prev, [key]: on };
      writeStoredSections(next);
      return next;
    });
  }, []);

  return { sections, setSection };
}
