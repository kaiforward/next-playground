import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/card";
import { CreateFactionForm } from "@/components/start/create-faction-form";

export const metadata: Metadata = {
  title: "Stellar Trader — New Game",
};

/**
 * New-game setup — author the faction you'll rule (name, government, doctrine)
 * plus galaxy size and an optional seed. Outside the (game) layout, like /start,
 * so it renders with no game shell or world requirement.
 */
export default function NewGamePage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-6 px-6 py-12">
      <div className="w-full max-w-md">
        <Link href="/start" className="text-sm text-text-tertiary hover:text-text-secondary">
          ← Back
        </Link>
        <Card className="mt-4">
          <CardHeader title="New Game" subtitle="Author the faction you'll rule." />
          <CreateFactionForm />
        </Card>
      </div>
    </main>
  );
}
