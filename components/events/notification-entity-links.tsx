"use client";

import Link from "next/link";
import type { EntityRef } from "@/lib/types/game";

interface NotificationEntityLinksProps {
  refs: Partial<Record<string, EntityRef>>;
}

/** Renders clickable links for entity refs (system, ship). Shared by toasts and event panel. */
export function NotificationEntityLinks({ refs }: NotificationEntityLinksProps) {
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
