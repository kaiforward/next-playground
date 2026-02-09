"use client";

interface TickDisplayProps {
  currentTick: number;
}

export function TickDisplay({ currentTick }: TickDisplayProps) {
  return (
    <div className="flex items-center gap-2 text-xs" aria-live="polite" aria-atomic="true">
      <div className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
      <span className="text-white/40 font-mono">
        Tick {currentTick}
      </span>
    </div>
  );
}
