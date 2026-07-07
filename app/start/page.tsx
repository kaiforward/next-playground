import type { Metadata } from "next";
import { StartScreen } from "@/components/start/start-screen";

export const metadata: Metadata = {
  title: "Stellar Trader — Start",
};

/**
 * Standalone entry screen — deliberately outside the (game) layout so it
 * renders with no game shell, providers, or world requirement. All world
 * data flows through the lifecycle API routes; on success the client does a
 * hard navigation to "/" for a fresh TanStack cache against the new world.
 */
export default function StartPage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-10 px-6 py-12">
      <header className="text-center">
        <h1 className="font-display font-bold uppercase tracking-widest text-4xl text-text-accent">
          Stellar Trader
        </h1>
        <p className="mt-3 text-sm text-text-tertiary">
          A living galaxy, simulated on your machine.
        </p>
      </header>
      <StartScreen />
    </main>
  );
}
