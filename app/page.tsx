import type { Metadata } from "next";
import ConfigForm from "@/components/ConfigForm";
import HeroHeader from "@/components/HeroHeader";
import OddsTicker from "@/components/OddsTicker";

export const metadata: Metadata = {
  title: "Strange Bets — Smart Betting Picks & Codes",
  description:
    "Pick your sport, choose your odds types, and get expert-consensus safe picks with a shareable betting code.",
};

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <OddsTicker />
      <HeroHeader />

      <main className="mt-8 flex-1">
        <ConfigForm />
      </main>

      <footer className="relative z-10 border-t-2 border-white px-4 py-5 text-center text-xs text-zinc-300">
        <p className="tag">
          odds move fast — confirm prices in your bookmaker before staking
          <span className="mx-2 text-zinc-500">{"//"}</span>18+
          <span className="mx-2 text-zinc-500">{"//"}</span>
          gamble responsibly
        </p>
      </footer>
    </div>
  );
}
