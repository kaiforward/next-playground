"use client";

import { ChevronRight } from "lucide-react";
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
        <ChevronRight className="w-3 h-3 text-gray-400 transition-transform group-open:rotate-90" />
        <SectionHeader as="h3">
          {summary}
          {count != null && (
            <span className="ml-1 text-text-tertiary">({count})</span>
          )}
        </SectionHeader>
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}
