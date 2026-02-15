"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useFleet } from "@/lib/hooks/use-fleet";
import { formatCredits } from "@/lib/utils/format";
import { TickDisplay } from "@/components/fleet/tick-display";
import { useDialog } from "@/components/ui/dialog";
import { ActivityPanel } from "@/components/events/activity-panel";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Command Center" },
  { href: "/map", label: "Star Map" },
];

function NavCredits() {
  const { fleet } = useFleet();
  return (
    <span className="text-sm font-medium text-green-400">
      {formatCredits(fleet.credits)}
    </span>
  );
}

interface GameNavProps {
  userEmail: string | null;
  currentTick: number;
}

export default function GameNav({ userEmail, currentTick }: GameNavProps) {
  const pathname = usePathname();
  const historyDialog = useDialog();

  return (
    <>
      <header className="h-12 border-b border-white/10 bg-black/40 backdrop-blur-sm">
        <div className="h-full max-w-7xl mx-auto px-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className="text-xl font-bold tracking-wider">
              Stellar Trader
            </Link>
            <TickDisplay currentTick={currentTick} />
            <Suspense fallback={<span className="text-sm font-medium text-white/30">---</span>}>
              <NavCredits />
            </Suspense>
          </div>
          <nav className="flex items-center gap-6">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`text-sm font-medium transition-colors hover:text-white ${
                  pathname === item.href ? "text-white" : "text-white/50"
                }`}
              >
                {item.label}
              </Link>
            ))}

            {/* Event history bell */}
            <button
              onClick={historyDialog.onOpen}
              className="relative text-white/50 hover:text-white transition-colors p-1"
              aria-label="Event history"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4.5 h-4.5">
                <path fillRule="evenodd" d="M10 2a6 6 0 0 0-6 6c0 1.887-.454 3.665-1.257 5.234a.75.75 0 0 0 .67 1.085h3.652a2.75 2.75 0 0 0 5.47 0h3.652a.75.75 0 0 0 .67-1.085A11.95 11.95 0 0 1 16 8a6 6 0 0 0-6-6Zm1.493 12.319a1.25 1.25 0 0 1-2.986 0h2.986Z" clipRule="evenodd" />
              </svg>
            </button>

            <div className="flex items-center gap-3 ml-2 pl-4 border-l border-white/10">
              {userEmail && (
                <span className="text-xs text-white/40">{userEmail}</span>
              )}
              <button
                onClick={() => signOut({ redirectTo: "/login" })}
                className="text-sm text-white/50 hover:text-white transition-colors"
              >
                Sign Out
              </button>
            </div>
          </nav>
        </div>
      </header>

      <ActivityPanel open={historyDialog.open} onClose={historyDialog.onClose} />
    </>
  );
}
