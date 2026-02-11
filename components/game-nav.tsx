"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { TickDisplay } from "@/components/fleet/tick-display";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Command Center" },
  { href: "/map", label: "Star Map" },
];

interface GameNavProps {
  userEmail: string | null;
  currentTick: number;
}

export default function GameNav({ userEmail, currentTick }: GameNavProps) {
  const pathname = usePathname();

  return (
    <header className="h-12 border-b border-white/10 bg-black/40 backdrop-blur-sm">
      <div className="h-full max-w-7xl mx-auto px-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/dashboard" className="text-xl font-bold tracking-wider">
            Stellar Trader
          </Link>
          <TickDisplay currentTick={currentTick} />
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
  );
}
