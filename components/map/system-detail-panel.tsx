"use client";

import { tv } from "tailwind-variants";
import type { StarSystemInfo, EconomyType } from "@/lib/types/game";

interface SystemDetailPanelProps {
  system: StarSystemInfo | null;
  isPlayerHere: boolean;
  onNavigate: () => void;
  onClose: () => void;
}

const economyBadge = tv({
  base: "inline-block rounded-full px-3 py-0.5 text-xs font-semibold uppercase tracking-wider",
  variants: {
    economyType: {
      agricultural: "bg-green-900/80 text-green-300 ring-1 ring-green-500/40",
      mining: "bg-amber-900/80 text-amber-300 ring-1 ring-amber-500/40",
      industrial: "bg-slate-700/80 text-slate-300 ring-1 ring-slate-400/40",
      tech: "bg-blue-900/80 text-blue-300 ring-1 ring-blue-500/40",
      core: "bg-purple-900/80 text-purple-300 ring-1 ring-purple-500/40",
    },
  },
});

export function SystemDetailPanel({
  system,
  isPlayerHere,
  onNavigate,
  onClose,
}: SystemDetailPanelProps) {
  if (!system) return null;

  return (
    <div className="fixed top-0 right-0 h-full w-80 bg-gray-900/95 border-l border-gray-700 shadow-2xl z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
        <h2 className="text-lg font-bold text-white">{system.name}</h2>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white transition-colors p-1 rounded hover:bg-gray-800"
          aria-label="Close panel"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
        {/* Economy badge */}
        <div>
          <span className={economyBadge({ economyType: system.economyType as EconomyType })}>
            {system.economyType}
          </span>
          {isPlayerHere && (
            <span className="ml-2 inline-block rounded-full bg-yellow-900/80 text-yellow-300 ring-1 ring-yellow-500/40 px-3 py-0.5 text-xs font-semibold uppercase tracking-wider">
              Current Location
            </span>
          )}
        </div>

        {/* Description */}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">
            Description
          </h3>
          <p className="text-sm text-gray-300 leading-relaxed">
            {system.description}
          </p>
        </div>

        {/* Coordinates */}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">
            Coordinates
          </h3>
          <p className="text-sm text-gray-300 font-mono">
            X: {system.x} &middot; Y: {system.y}
          </p>
        </div>

        {/* System ID */}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">
            System ID
          </h3>
          <p className="text-sm text-gray-400 font-mono">{system.id}</p>
        </div>
      </div>

      {/* Actions */}
      <div className="px-4 py-3 border-t border-gray-700 space-y-2">
        <button
          onClick={onNavigate}
          disabled={isPlayerHere}
          className={`w-full py-2 px-4 rounded-lg text-sm font-semibold transition-all ${
            isPlayerHere
              ? "bg-gray-700 text-gray-500 cursor-not-allowed"
              : "bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-900/30 active:scale-[0.98]"
          }`}
        >
          {isPlayerHere ? "Already Here" : "Navigate Here"}
        </button>
        <button
          onClick={onClose}
          className="w-full py-2 px-4 rounded-lg text-sm font-medium text-gray-400 hover:text-white hover:bg-gray-800 transition-all"
        >
          Close
        </button>
      </div>
    </div>
  );
}
