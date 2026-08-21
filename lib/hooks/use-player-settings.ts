"use client";

import { sendCommand } from "@/lib/runtime/command-client";
import { narrowCommandResult } from "@/lib/types/guards";
import { useCommandMutation, type CommandMutation } from "@/lib/hooks/use-command-mutation";
import { clearOnNextFrame } from "@/lib/store/command-overlay";
import { alertCategoriesOverlay, GLOBAL_ALERTS_KEY } from "./use-alerts";
import { trackerSectionsOverlay, GLOBAL_TRACKER_KEY } from "./use-tracker";
import type { AlertCategoryInput, TrackerSectionInput } from "@/lib/schemas/player-settings";
import type { CommandResult } from "@/lib/runtime/channel";
import type { AlertCategorySettings } from "@/lib/types/alerts";
import type { TrackerSections } from "@/lib/types/tracker";
import type { SetAlertCategoryResult, SetTrackerSectionResult } from "@/lib/services/player-settings";

type SetAlertCategoryData = Extract<SetAlertCategoryResult, { ok: true }>["data"];
type SetTrackerSectionData = Extract<SetTrackerSectionResult, { ok: true }>["data"];

function sendSetAlertCategory(input: AlertCategoryInput): Promise<CommandResult<AlertCategorySettings>> {
  const id = crypto.randomUUID();
  return sendCommand({ id, type: "setAlertCategory", payload: input }).then((message) =>
    narrowCommandResult<SetAlertCategoryData>(message.result),
  );
}

function sendSetTrackerSection(input: TrackerSectionInput): Promise<CommandResult<TrackerSections>> {
  const id = crypto.randomUUID();
  return sendCommand({ id, type: "setTrackerSection", payload: input }).then((message) =>
    narrowCommandResult<SetTrackerSectionData>(message.result),
  );
}

/**
 * Turn one alert category on or off (`setAlertCategory` command). The result already carries the
 * full merged `categorySettings` record, written into `useAlerts`'s overlay on success — the
 * client-runtime in-flight rule (spec §2): the checkbox flips on this response, not the next state
 * frame.
 */
export function useSetAlertCategory(): CommandMutation<AlertCategoryInput, AlertCategorySettings> {
  return useCommandMutation(async (input) => {
    const result = await sendSetAlertCategory(input);
    if (result.ok) {
      alertCategoriesOverlay.set(GLOBAL_ALERTS_KEY, result.data);
      clearOnNextFrame(alertCategoriesOverlay, GLOBAL_ALERTS_KEY);
    }
    return result;
  });
}

/** Show or hide one Tracker section (`setTrackerSection` command) — same pattern as
 *  `useSetAlertCategory`, overlaid into `useTracker`. */
export function useSetTrackerSection(): CommandMutation<TrackerSectionInput, TrackerSections> {
  return useCommandMutation(async (input) => {
    const result = await sendSetTrackerSection(input);
    if (result.ok) {
      trackerSectionsOverlay.set(GLOBAL_TRACKER_KEY, result.data);
      clearOnNextFrame(trackerSectionsOverlay, GLOBAL_TRACKER_KEY);
    }
    return result;
  });
}
