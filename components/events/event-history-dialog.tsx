"use client";

import Link from "next/link";
import { Dialog } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useEventHistory } from "@/components/providers/event-history-provider";
import { NOTIFICATION_BADGE_COLOR } from "@/lib/constants/ui";
import { formatRelativeTime } from "@/lib/utils/format";
import type { EntityRef } from "@/lib/types/game";

interface EventHistoryDialogProps {
  open: boolean;
  onClose: () => void;
}

export function EventHistoryDialog({ open, onClose }: EventHistoryDialogProps) {
  const { notifications } = useEventHistory();

  return (
    <Dialog
      open={open}
      onClose={onClose}
      modal
      className="backdrop:bg-black/60 bg-transparent fixed top-1/2 left-8 -translate-y-1/2"
    >
      <div className="w-[440px] max-w-[calc(100vw-2rem)] max-h-[70vh] flex flex-col rounded-xl border border-white/10 bg-gray-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <h2 className="text-sm font-bold text-white">Event History</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-white transition-colors p-0.5"
            aria-label="Close event history"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {notifications.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-white/40">
              No events yet
            </div>
          ) : (
            <ul className="divide-y divide-white/5">
              {notifications.map((n) => (
                <li key={n.id} className="px-4 py-2.5 flex items-start gap-3">
                  {/* Timestamp */}
                  <span className="text-[10px] text-white/30 mt-0.5 w-12 shrink-0 text-right tabular-nums">
                    {formatRelativeTime(n.receivedAt)}
                  </span>

                  <div className="flex-1 min-w-0">
                    {/* Type badge + message */}
                    <div className="flex items-center gap-2">
                      <Badge color={NOTIFICATION_BADGE_COLOR[n.type] ?? "slate"}>
                        {n.type.replace(/_/g, " ")}
                      </Badge>
                    </div>
                    <p className="text-xs text-gray-300 mt-0.5 leading-relaxed">{n.message}</p>

                    {/* Entity links */}
                    <HistoryEntityLinks refs={n.refs} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Dialog>
  );
}

function HistoryEntityLinks({ refs }: { refs: Partial<Record<string, EntityRef>> }) {
  const links: React.ReactNode[] = [];

  if (refs.system) {
    links.push(
      <Link
        key="system"
        href={`/system/${refs.system.id}`}
        className="text-blue-400 hover:text-blue-300 transition-colors"
      >
        {refs.system.label}
      </Link>,
    );
  }

  if (refs.ship) {
    links.push(
      <Link
        key="ship"
        href={`/ship/${refs.ship.id}`}
        className="text-cyan-400 hover:text-cyan-300 transition-colors"
      >
        {refs.ship.label}
      </Link>,
    );
  }

  if (links.length === 0) return null;

  return (
    <div className="flex gap-2 mt-1 text-[11px]">
      {links}
    </div>
  );
}
