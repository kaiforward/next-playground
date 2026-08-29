"use client";

import { CheckboxInput } from "@/components/form/checkbox-input";
import { useTracker } from "@/lib/hooks/use-tracker";
import { useSetTrackerSection } from "@/lib/hooks/use-player-settings";
import { TRACKER_SECTION_KEYS } from "@/lib/types/tracker";
import type { TrackerSectionKey, TrackerSections } from "@/lib/types/tracker";

const SECTION_LABELS: Record<TrackerSectionKey, string> = {
  pinned: "Pinned",
  building: "Building",
  colonising: "Colonising",
};

export interface TrackerSettingsProps {
  sections: TrackerSections;
  onChangeSection: (key: TrackerSectionKey, on: boolean) => void;
}

/**
 * The Tracker's settings surface (docs/active/gameplay/tracker.md → "Settings") — a checkbox per
 * section, unticked meaning the section (heading included) is filtered out of `TrackerPanel`.
 *
 * A sibling PANEL, not a `Popover` or a dropdown menu: hiding a section is a standing view
 * preference the player sets once and forgets, not a transient lookup that should vanish on
 * pointer-leave — it earns a persistent surface of its own. Rendered by `MapRightRail`
 * immediately to the LEFT of `TrackerPanel` inside their shared horizontal pair, opened and
 * closed by the toggle button in the Tracker's own header. `MapRightRail` mounts this
 * conditionally on that open state — unmounting the whole component IS the closed state, so
 * there is no internal "closed" branch here, and no space is claimed in the rail when it isn't
 * rendered.
 *
 * Same surface, border and header treatment as `TrackerPanel` so the two read as one family of
 * panel, per the Foundry no-rounded-corners convention.
 */
export function TrackerSettings({ sections, onChangeSection }: TrackerSettingsProps) {
  return (
    <div className="pointer-events-auto flex h-full min-h-0 w-44 shrink-0 flex-col border border-border bg-surface/95 shadow-lg backdrop-blur">
      <div className="shrink-0 border-b border-border px-3 py-2">
        <h2 className="font-display text-xs font-bold uppercase tracking-[0.18em] text-text-secondary">
          Tracker settings
        </h2>
      </div>
      <div role="group" aria-label="Tracker sections" className="min-h-0 flex-1 overflow-y-auto py-1">
        {/* `TRACKER_SECTION_KEYS` is authored in the panel's own section order (top to bottom), so a
            row here maps visually to the section it controls — no second copy of that order to drift. */}
        {TRACKER_SECTION_KEYS.map((key) => (
          <CheckboxInput
            key={key}
            label={SECTION_LABELS[key]}
            checked={sections[key]}
            onChange={(on) => onChangeSection(key, on)}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * The settings panel's data half: reads the stored section flags off the Tracker payload they ride
 * on and writes one flag back per checkbox. Split from `TrackerSettings` itself so that component
 * stays pure props-in and renderable without a query client — the same split `AlertSettings` has
 * against `AlertRunChips`.
 *
 * It reads `useTracker()` rather than taking `sections` down from `MapRightRail`: this panel and
 * `TrackerPanel` are siblings that must agree on the same live flags, and sharing one cached query
 * is what guarantees that now the state lives on the server. Mount inside an `ErrorBoundary`.
 */
export function TrackerSettingsPanel() {
  const { sections } = useTracker();
  const setSection = useSetTrackerSection();
  return (
    <TrackerSettings
      sections={sections}
      onChangeSection={(section, on) => setSection.mutate({ section, on })}
    />
  );
}
