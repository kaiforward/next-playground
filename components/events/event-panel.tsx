"use client";

import { useMemo, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { EconomyEventsTab } from "@/components/events/economy-events-tab";
import { ShipLogTab } from "@/components/events/ship-log-tab";
import { useEvents } from "@/lib/hooks/use-events";
import { useEventHistory } from "@/components/providers/event-history-provider";

interface EventPanelProps {
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
  { id: "ship_log", label: "Ship Log" },
];

export function EventPanel({ open, onClose }: EventPanelProps) {
  const [activeTab, setActiveTab] = useState("economy");

  // Counts for tab labels
  const { events } = useEvents();
  const { notifications } = useEventHistory();
  const shipCount = useMemo(
    () => notifications.filter((n) => SHIP_EVENT_TYPES.has(n.type)).length,
    [notifications],
  );

  function getCount(tabId: string): number {
    if (tabId === "economy") return events.length;
    if (tabId === "ship_log") return shipCount;
    return 0;
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      modal
      className="backdrop:bg-black/60 bg-transparent fixed top-1/2 left-8 -translate-y-1/2"
    >
      <div className="w-[480px] max-w-[calc(100vw-2rem)] max-h-[70vh] flex flex-col rounded-xl border border-white/10 bg-gray-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <h2 className="text-sm font-bold text-white">Events</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-white transition-colors p-0.5"
            aria-label="Close event panel"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-white/10 px-4">
          {TABS.map((tab) => {
            const count = getCount(tab.id);
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                  isActive
                    ? "text-white border-indigo-400"
                    : "text-white/50 border-transparent hover:text-white/70"
                }`}
              >
                {tab.label}
                {count > 0 && (
                  <span className={`ml-1.5 text-xs ${isActive ? "text-indigo-300" : "text-white/30"}`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {activeTab === "economy" && <EconomyEventsTab />}
          {activeTab === "ship_log" && <ShipLogTab />}
        </div>
      </div>
    </Dialog>
  );
}
