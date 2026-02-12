"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { tv } from "tailwind-variants";
import { useTickContext } from "@/lib/hooks/use-tick-context";
import { EVENT_TYPE_BADGE_COLOR } from "@/lib/constants/ui";

type AccentColor = "red" | "amber" | "purple";

interface Toast {
  id: number;
  message: string;
  accentColor: AccentColor;
}

interface EventNotification {
  message: string;
  type: string;
}

const DISMISS_MS = 8_000;
const MAX_VISIBLE = 5;

const ACCENT_MAP: Record<string, AccentColor> = {
  red: "red",
  amber: "amber",
};

function toAccentColor(badgeColor: string): AccentColor {
  return ACCENT_MAP[badgeColor] ?? "purple";
}

const toastAccent = tv({
  base: "relative rounded-lg bg-gray-900/95 backdrop-blur border border-gray-700 border-l-4 px-4 py-3 pr-8 shadow-lg text-sm text-gray-200 max-w-sm",
  variants: {
    color: {
      red: "border-l-red-500",
      amber: "border-l-amber-500",
      purple: "border-l-purple-500",
    },
  },
});

let nextId = 0;

export function EventToastContainer() {
  const { subscribeToEvent } = useTickContext();
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
    (message: string, type: string) => {
      const id = nextId++;
      const accentColor = toAccentColor(EVENT_TYPE_BADGE_COLOR[type]);

      setToasts((prev) => {
        const next = [...prev, { id, message, accentColor }];
        // Trim oldest when over limit
        return next.length > MAX_VISIBLE ? next.slice(next.length - MAX_VISIBLE) : next;
      });

      const timer = setTimeout(() => {
        dismissToast(id);
      }, DISMISS_MS);
      timersRef.current.set(id, timer);
    },
    [dismissToast],
  );

  useEffect(() => {
    const unsub = subscribeToEvent("eventNotifications", (events: unknown[]) => {
      for (const evt of events) {
        const n = evt as EventNotification;
        if (n.message) {
          addToast(n.message, n.type);
        }
      }
    });
    return unsub;
  }, [subscribeToEvent, addToast]);

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
          {toast.message}
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
