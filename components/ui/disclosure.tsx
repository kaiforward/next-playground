"use client";

import { SectionHeader } from "./section-header";

interface DisclosureProps {
  summary: string;
  count?: number;
  defaultOpen?: boolean;
  className?: string;
  children: React.ReactNode;
}

export function Disclosure({
  summary,
  count,
  defaultOpen,
  className,
  children,
}: DisclosureProps) {
  return (
    <details open={defaultOpen} className={`group ${className ?? ""}`}>
      <summary className="flex items-center gap-2 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
        <svg
          className="w-3 h-3 text-gray-400 transition-transform group-open:rotate-90"
          viewBox="0 0 12 12"
          fill="currentColor"
        >
          <path d="M4.5 2l5 4-5 4V2z" />
        </svg>
        <SectionHeader as="h3">
          {summary}
          {count != null && (
            <span className="ml-1 text-text-faint">({count})</span>
          )}
        </SectionHeader>
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}
