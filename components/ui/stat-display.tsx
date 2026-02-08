"use client";

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
        <div className="mt-1 text-white/40">{icon}</div>
      )}
      <div>
        <p className="text-xs font-medium text-white/50 uppercase tracking-wider">
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
              {trend === "up" ? (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="w-4 h-4 inline"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 17a.75.75 0 01-.75-.75V5.612L5.29 9.77a.75.75 0 01-1.08-1.04l5.25-5.5a.75.75 0 011.08 0l5.25 5.5a.75.75 0 11-1.08 1.04l-3.96-4.158V16.25A.75.75 0 0110 17z"
                    clipRule="evenodd"
                  />
                </svg>
              ) : (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="w-4 h-4 inline"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 3a.75.75 0 01.75.75v10.638l3.96-4.158a.75.75 0 111.08 1.04l-5.25 5.5a.75.75 0 01-1.08 0l-5.25-5.5a.75.75 0 111.08-1.04l3.96 4.158V3.75A.75.75 0 0110 3z"
                    clipRule="evenodd"
                  />
                </svg>
              )}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
