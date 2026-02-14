"use client";

import { useState } from "react";
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
      <button
        onClick={() => setOpen(!open)}
        className="absolute bottom-0 right-0 w-9 h-9 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center shadow-lg transition-colors text-sm"
        title="Dev Tools"
      >
        {open ? "\u2715" : "\u2699"}
      </button>

      {/* Panel */}
      {open && (
        <div className="mb-12 w-[400px] max-h-[500px] bg-gray-900 border border-white/10 rounded-lg shadow-2xl flex flex-col overflow-hidden">
          {/* Header */}
          <div className="px-3 py-2 border-b border-white/10 flex items-center gap-2">
            <span className="text-xs font-semibold text-indigo-400 uppercase tracking-wider">
              Dev Tools
            </span>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-white/10">
            {TABS.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 py-1.5 text-xs font-medium transition-colors ${
                  tab === t
                    ? "text-indigo-400 border-b-2 border-indigo-400"
                    : "text-white/40 hover:text-white/70"
                }`}
              >
                {t}
              </button>
            ))}
          </div>

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
