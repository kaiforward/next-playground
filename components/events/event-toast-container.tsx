"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { tv } from "tailwind-variants";
import { useEventHistory } from "@/components/providers/event-history-provider";
import { NOTIFICATION_BADGE_COLOR } from "@/lib/constants/ui";
import type { GameNotification, EntityRef } from "@/lib/types/game";

type AccentColor = "red" | "amber" | "purple" | "blue" | "green" | "slate";

interface Toast {
  id: number;
  message: string;
  accentColor: AccentColor;
  refs: Partial<Record<string, EntityRef>>;
}

const DISMISS_MS = 8_000;
const MAX_VISIBLE = 5;

function toAccentColor(type: string): AccentColor {
  return NOTIFICATION_BADGE_COLOR[type] ?? "purple";
}

const toastAccent = tv({
  base: "relative rounded-lg bg-gray-900/95 backdrop-blur border border-gray-700 border-l-4 px-4 py-3 pr-8 shadow-lg text-sm text-gray-200 max-w-sm",
  variants: {
    color: {
      red: "border-l-red-500",
      amber: "border-l-amber-500",
      purple: "border-l-purple-500",
      blue: "border-l-blue-500",
      green: "border-l-green-500",
      slate: "border-l-slate-500",
    },
  },
});

export function EventToastContainer() {
  const { subscribe } = useEventHistory();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const addToast = useCallback(
    (notification: GameNotification) => {
      const accentColor = toAccentColor(notification.type);

      setToasts((prev) => {
        const next = [...prev, {
          id: notification.id,
          message: notification.message,
          accentColor,
          refs: notification.refs,
        }];
        return next.length > MAX_VISIBLE ? next.slice(next.length - MAX_VISIBLE) : next;
      });

      const timer = setTimeout(() => {
        dismissToast(notification.id);
      }, DISMISS_MS);
      timersRef.current.set(notification.id, timer);
    },
    [dismissToast],
  );

  useEffect(() => {
    return subscribe(addToast);
  }, [subscribe, addToast]);

  // Cleanup timers on unmount
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div role="status" aria-live="polite" className="fixed bottom-4 right-4 z-[100] flex flex-col-reverse gap-2">
      {toasts.map((toast) => (
        <div key={toast.id} className={toastAccent({ color: toast.accentColor })}>
          <div>{toast.message}</div>
          {/* Entity links */}
          <EntityLinks refs={toast.refs} />
          <button
            onClick={() => dismissToast(toast.id)}
            className="absolute top-1.5 right-1.5 text-gray-500 hover:text-white transition-colors p-0.5"
            aria-label="Dismiss notification"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}

/** Renders clickable links for entity refs (system, ship). */
function EntityLinks({ refs }: { refs: Partial<Record<string, EntityRef>> }) {
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
    <div className="flex gap-2 mt-1 text-xs">
      {links}
    </div>
  );
}
