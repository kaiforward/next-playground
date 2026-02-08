"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/map", label: "Star Map" },
  { href: "/trade", label: "Trade" },
];

export default function GameNav({ userEmail }: { userEmail: string | null }) {
  const pathname = usePathname();

  return (
    <header className="border-b border-white/10 bg-black/40 backdrop-blur-sm">
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
        <Link href="/dashboard" className="text-xl font-bold tracking-wider">
          Stellar Trader
        </Link>
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
