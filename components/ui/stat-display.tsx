"use client";

import { TrendIcon } from "./trend-icon";

interface StatDisplayProps {
  label: string;
  value: string | number;
  trend?: "up" | "down" | "neutral";
  icon?: React.ReactNode;
}

export function StatDisplay({ label, value, trend, icon }: StatDisplayProps) {
  return (
    <div className="flex items-start gap-3">
      {icon && (
        <div className="mt-1 text-text-muted">{icon}</div>
      )}
      <div>
        <p className="text-xs font-medium text-text-tertiary uppercase tracking-wider">
          {label}
        </p>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-2xl font-bold text-white">{value}</span>
          {trend && trend !== "neutral" && (
            <span
              className={`text-sm font-medium ${
                trend === "up" ? "text-green-400" : "text-red-400"
              }`}
            >
              <TrendIcon direction={trend} />
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
