import { SPORTS } from "@/lib/sports";

export async function GET() {
  return Response.json({
    sports: SPORTS.map((s) => ({
      id: s.id,
      label: s.label,
      icon: s.icon,
      markets: s.markets,
    })),
    markets: [
      { id: "h2h", label: "Match Winner (1X2)" },
      { id: "totals", label: "Over / Under" },
      { id: "spreads", label: "Handicap / Spread" },
      { id: "btts", label: "Both Teams To Score" },
      { id: "double_chance", label: "Double Chance" },
      { id: "draw_no_bet", label: "Draw No Bet" },
      { id: "odd_even", label: "Odd / Even" },
    ],
  });
}
