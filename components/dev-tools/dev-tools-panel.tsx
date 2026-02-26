"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { TabList, Tab } from "@/components/ui/tabs";
import { TickControlSection } from "./tick-control-section";
import { EventSpawnerSection } from "./event-spawner-section";
import { EconomyOverviewSection } from "./economy-overview-section";
import { CheatsSection } from "./cheats-section";

const TABS = ["Tick", "Events", "Economy", "Cheats"] as const;
type Tab = (typeof TABS)[number];

export function DevToolsPanel() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("Tick");

  return (
    <div className="fixed bottom-4 right-16 z-50">
      {/* Toggle button */}
      <Button
        variant="primary"
        size="sm"
        onClick={() => setOpen(!open)}
        className="absolute bottom-0 right-0 w-9 h-9 rounded-full p-0 bg-indigo-600 hover:bg-indigo-500 shadow-lg"
        title="Dev Tools"
      >
        {open ? "\u2715" : "\u2699"}
      </Button>

      {/* Panel */}
      {open && (
        <div className="mb-12 w-[400px] max-h-[500px] bg-gray-900 border border-border rounded-lg shadow-2xl flex flex-col overflow-hidden">
          {/* Header */}
          <div className="px-3 py-2 border-b border-border flex items-center gap-2">
            <span className="text-xs font-semibold text-indigo-400 uppercase tracking-wider">
              Dev Tools
            </span>
          </div>

          {/* Tabs */}
          <TabList>
            {TABS.map((t) => (
              <Tab
                key={t}
                active={tab === t}
                onClick={() => setTab(t)}
                className="flex-1 py-1.5 text-xs"
              >
                {t}
              </Tab>
            ))}
          </TabList>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-3">
            {tab === "Tick" && <TickControlSection />}
            {tab === "Events" && <EventSpawnerSection />}
            {tab === "Economy" && <EconomyOverviewSection />}
            {tab === "Cheats" && <CheatsSection />}
          </div>
        </div>
      )}
    </div>
  );
}
