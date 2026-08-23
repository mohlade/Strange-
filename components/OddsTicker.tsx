const FEED = [
  { pair: "ARS vs CHE", market: "H", odds: "2.10", dir: "up" },
  { pair: "MCI vs LIV", market: "O2.5", odds: "1.72", dir: "down" },
  { pair: "LAL vs BOS", market: "ML", odds: "1.95", dir: "up" },
  { pair: "RMA vs BAR", market: "BTTS", odds: "1.66", dir: "up" },
  { pair: "ATP · SINNER", market: "W1", odds: "1.33", dir: "down" },
  { pair: "BAY vs DOR", market: "X", odds: "3.80", dir: "up" },
  { pair: "GSW vs PHX", market: "O220.5", odds: "1.90", dir: "down" },
  { pair: "INT vs MIL", market: "DC 1X", odds: "1.41", dir: "up" },
  { pair: "NDL vs FRA", market: "U2.5", odds: "2.25", dir: "up" },
  { pair: "ATP · ALCAZAR", market: "W2", odds: "3.10", dir: "down" },
];

export default function OddsTicker() {
  const items = [...FEED, ...FEED];
  return (
    <div className="ticker-wrap select-none" aria-hidden>
      <div className="ticker">
        {items.map((o, i) => (
          <span
            key={i}
            className="tag flex items-center gap-2 border-r-2 border-black/20 px-4 py-1.5 font-bold whitespace-nowrap"
          >
            {o.pair}
            <span className="rounded-none bg-black px-1.5 py-0.5 text-ultra-bright">{o.market}</span>
            <span>
              {o.odds} {o.dir === "up" ? "▲" : "▼"}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
