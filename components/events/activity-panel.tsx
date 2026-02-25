"use client";

import { useMemo, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { TabList, Tab } from "@/components/ui/tabs";
import { EconomyEventsTab } from "@/components/events/economy-events-tab";
import { ShipLogTab } from "@/components/events/ship-log-tab";
import { MissionsTab } from "@/components/events/missions-tab";
import { useEvents } from "@/lib/hooks/use-events";
import { usePlayerMissions } from "@/lib/hooks/use-player-missions";
import { useEventHistory } from "@/components/providers/event-history-provider";
import { QueryBoundary } from "@/components/ui/query-boundary";

interface ActivityPanelProps {
  open: boolean;
  onClose: () => void;
}

const SHIP_EVENT_TYPES = new Set([
  "ship_arrived",
  "cargo_lost",
  "hazard_incident",
  "import_duty",
  "contraband_seized",
]);

interface TabDef {
  id: string;
  label: string;
}

const TABS: TabDef[] = [
  { id: "economy", label: "Economy" },
  { id: "missions", label: "Missions" },
  { id: "ship_log", label: "Ship Log" },
];

function ActivityPanelContent({ onClose }: { onClose: () => void }) {
  const [activeTab, setActiveTab] = useState("economy");

  // Counts for tab labels
  const { events } = useEvents();
  const { missions } = usePlayerMissions();
  const { notifications } = useEventHistory();
  const shipCount = useMemo(
    () => notifications.filter((n) => SHIP_EVENT_TYPES.has(n.type)).length,
    [notifications],
  );

  function getCount(tabId: string): number {
    if (tabId === "economy") return events.length;
    if (tabId === "missions") return missions.length;
    if (tabId === "ship_log") return shipCount;
    return 0;
  }

  return (
    <div className="w-[480px] max-w-[calc(100vw-2rem)] h-[70vh] flex flex-col rounded-xl border border-border bg-gray-900 shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h2 className="text-sm font-bold text-white">Activity</h2>
        <button
          onClick={onClose}
          className="text-gray-500 hover:text-white transition-colors p-0.5"
          aria-label="Close activity panel"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
          </svg>
        </button>
      </div>

      {/* Tab bar */}
      <TabList className="px-4">
        {TABS.map((tab) => (
          <Tab
            key={tab.id}
            active={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            count={getCount(tab.id)}
          >
            {tab.label}
          </Tab>
        ))}
      </TabList>

      {/* Content */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {activeTab === "economy" && <EconomyEventsTab />}
        {activeTab === "missions" && <MissionsTab />}
        {activeTab === "ship_log" && <ShipLogTab />}
      </div>
    </div>
  );
}

export function ActivityPanel({ open, onClose }: ActivityPanelProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      modal
      className="backdrop:bg-black/60 bg-transparent fixed top-16 left-8"
    >
      {open && (
        <QueryBoundary>
          <ActivityPanelContent onClose={onClose} />
        </QueryBoundary>
      )}
    </Dialog>
  );
}
