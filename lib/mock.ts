import type { Bookmaker, Game, OddsMarket, SportId } from "@/lib/types";
import { fallbackLeagues } from "@/lib/sports";
import { matchDay } from "@/lib/day";
import type { SportyEvent } from "@/lib/sportybet";

const BOOKMAKERS = [
  { key: "pinnacle", title: "Pinnacle" },
  { key: "bet365", title: "bet365" },
  { key: "unibet", title: "Unibet" },
  { key: "betway", title: "Betway" },
  { key: "williamhill", title: "William Hill" },
  { key: "1xbet", title: "1xBet" },
];

const SOCCER_TEAMS = [
  "Real Madrid",
  "Barcelona",
  "Arsenal",
  "Liverpool",
  "Man City",
  "Man Utd",
  "Chelsea",
  "PSG",
  "Bayern Munich",
  "Dortmund",
  "Juventus",
  "Inter Milan",
  "AC Milan",
  "Napoli",
  "Atletico Madrid",
  "Sevilla",
];

const BASKETBALL_TEAMS = [
  "Lakers",
  "Celtics",
  "Warriors",
  "Bucks",
  "Nuggets",
  "Suns",
  "Heat",
  "76ers",
  "Knicks",
  "Mavericks",
  "Clippers",
  "Nets",
  "Bulls",
  "Grizzlies",
  "Cavaliers",
  "Timberwolves",
];

const TENNIS_PLAYERS = [
  "J. Sinner",
  "C. Alcaraz",
  "N. Djokovic",
  "D. Medvedev",
  "A. Zverev",
  "A. Rublev",
  "H. Hurkacz",
  "T. Fritz",
  "C. Ruud",
  "S. Tsitsipas",
  "F. Auger-Aliassime",
  "K. Khachanov",
  "B. Shelton",
  "F. Tiafoe",
];

function seededRandom(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function hashString(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function round(n: number, decimals = 2): number {
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
}

function oddsFromProb(p: number, rand: () => number): number {
  const margin = 0.04 + rand() * 0.02;
  return round(1 / (p * (1 + margin)));
}

function makeSoccerGame(rand: () => number, idx: number, league: { key: string; title: string }): Game {
  const pool = [...SOCCER_TEAMS].sort(() => rand() - 0.5);
  const home = pool[0];
  const away = pool[1];
  const homeStrength = 0.5 + rand() * 0.35;
  const awayStrength = 0.5 + rand() * 0.35;

  const homeW = homeStrength / (homeStrength + awayStrength + 0.8);
  const awayW = awayStrength / (homeStrength + awayStrength + 0.8);
  const drawP = 0.8 / (homeStrength + awayStrength + 0.8);

  const markets: OddsMarket[] = [];
  const h2hOutcomes = [
    { name: home, price: oddsFromProb(homeW, rand) },
    { name: "Draw", price: oddsFromProb(drawP, rand) },
    { name: away, price: oddsFromProb(awayW, rand) },
  ];
  markets.push({ key: "h2h", outcomes: h2hOutcomes });

  const totalGoals = homeStrength + awayStrength + rand() * 1.2;
  const overProb = totalGoals >= 2.6 ? 0.5 + rand() * 0.12 : 0.5 - rand() * 0.12;
  const line = 2.5;
  markets.push({
    key: "totals",
    outcomes: [
      { name: "Over", point: line, price: oddsFromProb(overProb, rand) },
      { name: "Under", point: line, price: oddsFromProb(1 - overProb, rand) },
    ],
  });

  const favorite = homeW > awayW ? home : away;
  const dog = favorite === home ? away : home;
  const favoriteP = Math.max(homeW, awayW);
  const lineSpread = favoriteP > 0.62 ? -1.5 : -0.5;
  markets.push({
    key: "spreads",
    outcomes: [
      { name: favorite, point: lineSpread, price: oddsFromProb(favoriteP, rand) },
      { name: dog, point: -lineSpread, price: oddsFromProb(1 - favoriteP, rand) },
    ],
  });

  return buildGame(league.key, league.title, home, away, markets, idx, rand);
}

function makeBasketballGame(rand: () => number, idx: number, league: { key: string; title: string }): Game {
  const pool = [...BASKETBALL_TEAMS].sort(() => rand() - 0.5);
  const home = pool[0];
  const away = pool[1];
  const homeStrength = 0.5 + rand() * 0.4;
  const awayStrength = 0.5 + rand() * 0.4;
  const homeW = homeStrength / (homeStrength + awayStrength);
  const awayW = awayStrength / (homeStrength + awayStrength);

  const markets: OddsMarket[] = [];
  markets.push({
    key: "h2h",
    outcomes: [
      { name: home, price: oddsFromProb(homeW, rand) },
      { name: away, price: oddsFromProb(awayW, rand) },
    ],
  });

  const favoriteP = Math.max(homeW, awayW);
  const spread = Math.round((favoriteP - 0.5) * 60) / 10;
  markets.push({
    key: "spreads",
    outcomes: [
      { name: homeW > awayW ? home : away, point: -spread, price: oddsFromProb(0.52, rand) },
      { name: homeW > awayW ? away : home, point: spread, price: oddsFromProb(0.48, rand) },
    ],
  });

  const total = round(205 + rand() * 25);
  markets.push({
    key: "totals",
    outcomes: [
      { name: "Over", point: total, price: oddsFromProb(0.51, rand) },
      { name: "Under", point: total, price: oddsFromProb(0.49, rand) },
    ],
  });

  return buildGame(league.key, league.title, home, away, markets, idx, rand);
}

function makeTennisGame(rand: () => number, idx: number, league: { key: string; title: string }): Game {
  const pool = [...TENNIS_PLAYERS].sort(() => rand() - 0.5);
  const p1 = pool[0];
  const p2 = pool[1];
  const s1 = 0.5 + rand() * 0.35;
  const s2 = 0.5 + rand() * 0.35;
  const p1W = s1 / (s1 + s2);
  const p2W = s2 / (s1 + s2);

  const markets: OddsMarket[] = [];
  markets.push({
    key: "h2h",
    outcomes: [
      { name: p1, price: oddsFromProb(p1W, rand) },
      { name: p2, price: oddsFromProb(p2W, rand) },
    ],
  });

  const totalSets = 22 + rand() * 6;
  markets.push({
    key: "totals",
    outcomes: [
      { name: "Over", point: 22.5, price: oddsFromProb(totalSets > 22.5 ? 0.55 : 0.45, rand) },
      { name: "Under", point: 22.5, price: oddsFromProb(totalSets > 22.5 ? 0.45 : 0.55, rand) },
    ],
  });

  return buildGame(league.key, league.title, p1, p2, markets, idx, rand);
}

function buildGame(
  sportKey: string,
  sportTitle: string,
  home: string,
  away: string,
  markets: OddsMarket[],
  idx: number,
  rand: () => number,
  start?: Date,
): Game {
  const bookmakers: Bookmaker[] = BOOKMAKERS.map((bm) => ({
    key: bm.key,
    title: bm.title,
    markets: markets.map((m) => ({
      key: m.key,
      outcomes: m.outcomes.map((o) => ({
        name: o.name,
        price: round(o.price * (1 + (rand() - 0.5) * 0.08), 2),
        ...(o.point !== undefined ? { point: o.point } : {}),
      })),
    })),
  }));

  const startTime = start ?? new Date(Date.now() + (2 + idx) * 3 * 3600_000);
  const id = `${sportKey}_${idx}_${hashString(home + away)}`;

  return {
    id,
    sport_key: sportKey,
    sport_title: sportTitle,
    commence_time: startTime.toISOString(),
    home_team: home,
    away_team: away,
    bookmakers,
  };
}

export function generateMockGames(
  sport: SportId,
  count = 30,
  opts: { leagues?: string[]; day?: string; offset?: number } = {},
): Game[] {
  const leagues = (opts.leagues && opts.leagues.length > 0
    ? fallbackLeagues(sport).filter((l) => opts.leagues!.includes(l.key))
    : fallbackLeagues(sport)
  ).slice(0, 4);
  const seed = hashString(sport + new Date().toDateString() + leagues.map((l) => l.key).join(","));
  const rand = seededRandom(seed);
  const games: Game[] = [];
  for (let i = 0; i < count; i++) {
    const league = leagues[i % leagues.length];
    let game: Game;
    if (sport === "soccer") game = makeSoccerGame(rand, i, league);
    else if (sport === "basketball") game = makeBasketballGame(rand, i, league);
    else game = makeTennisGame(rand, i, league);
    if (matchDay(game.commence_time, opts.day ?? "any", opts.offset ?? 0)) games.push(game);
  }
  return games;
}

function makeCatalogGame(
  sport: SportId,
  rand: () => number,
  idx: number,
  league: { key: string; title: string },
  home: string,
  away: string,
  start: Date,
): Game {
  let markets: OddsMarket[];
  if (sport === "soccer") {
    const homeStrength = 0.5 + rand() * 0.35;
    const awayStrength = 0.5 + rand() * 0.35;
    const homeW = homeStrength / (homeStrength + awayStrength + 0.8);
    const awayW = awayStrength / (homeStrength + awayStrength + 0.8);
    const drawP = 0.8 / (homeStrength + awayStrength + 0.8);

    const overProb = homeStrength + awayStrength + rand() * 1.2 >= 2.6 ? 0.5 + rand() * 0.12 : 0.5 - rand() * 0.12;
    const favorite = homeW > awayW ? home : away;
    const dog = favorite === home ? away : home;
    const lineSpread = Math.max(homeW, awayW) > 0.62 ? -1.5 : -0.5;

    markets = [
      {
        key: "h2h",
        outcomes: [
          { name: home, price: oddsFromProb(homeW, rand) },
          { name: "Draw", price: oddsFromProb(drawP, rand) },
          { name: away, price: oddsFromProb(awayW, rand) },
        ],
      },
      {
        key: "totals",
        outcomes: [
          { name: "Over", point: 2.5, price: oddsFromProb(overProb, rand) },
          { name: "Under", point: 2.5, price: oddsFromProb(1 - overProb, rand) },
        ],
      },
      {
        key: "spreads",
        outcomes: [
          { name: favorite, point: lineSpread, price: oddsFromProb(Math.max(homeW, awayW), rand) },
          { name: dog, point: -lineSpread, price: oddsFromProb(1 - Math.max(homeW, awayW), rand) },
        ],
      },
    ];
  } else if (sport === "basketball") {
    const homeStrength = 0.5 + rand() * 0.4;
    const awayStrength = 0.5 + rand() * 0.4;
    const homeW = homeStrength / (homeStrength + awayStrength);
    const awayW = awayStrength / (homeStrength + awayStrength);
    const spread = Math.round((Math.max(homeW, awayW) - 0.5) * 60) / 10;
    // Real basketball totals are quoted at half-point lines (e.g. 218.5);
    // anything else won't match a bookable SportyBet specifier.
    const total = Math.round(204 + rand() * 25) + 0.5;

    markets = [
      {
        key: "h2h",
        outcomes: [
          { name: home, price: oddsFromProb(homeW, rand) },
          { name: away, price: oddsFromProb(awayW, rand) },
        ],
      },
      {
        key: "spreads",
        outcomes: [
          { name: homeW > awayW ? home : away, point: -spread, price: oddsFromProb(0.52, rand) },
          { name: homeW > awayW ? away : home, point: spread, price: oddsFromProb(0.48, rand) },
        ],
      },
      {
        key: "totals",
        outcomes: [
          { name: "Over", point: total, price: oddsFromProb(0.51, rand) },
          { name: "Under", point: total, price: oddsFromProb(0.49, rand) },
        ],
      },
    ];
  } else {
    const s1 = 0.5 + rand() * 0.35;
    const s2 = 0.5 + rand() * 0.35;
    const p1W = s1 / (s1 + s2);
    const totalSets = 22 + rand() * 6;

    markets = [
      {
        key: "h2h",
        outcomes: [
          { name: home, price: oddsFromProb(p1W, rand) },
          { name: away, price: oddsFromProb(1 - p1W, rand) },
        ],
      },
      {
        key: "totals",
        outcomes: [
          { name: "Over", point: 22.5, price: oddsFromProb(totalSets > 22.5 ? 0.55 : 0.45, rand) },
          { name: "Under", point: 22.5, price: oddsFromProb(totalSets > 22.5 ? 0.45 : 0.55, rand) },
        ],
      },
    ];
  }

  return buildGame(league.key, league.title, home, away, markets, idx, rand, start);
}

const CATALOG_KEYS: Record<SportId, string> = {
  soccer: "soccer_catalog",
  basketball: "basketball_catalog",
  tennis: "tennis_catalog",
};

const CATALOG_MAX_GAMES = 200;

export function generateCatalogGames(
  sport: SportId,
  events: SportyEvent[],
  opts: { leagues?: string[]; day?: string; offset?: number } = {},
): Game[] {
  const rand = seededRandom(hashString(sport + "sporty-catalog" + new Date().toDateString()));
  const sportKey = CATALOG_KEYS[sport];
  const games: Game[] = [];
  let idx = 0;
  for (const ev of events) {
    const start = new Date(ev.startTime);
    if (Number.isNaN(start.getTime()) || !ev.home || !ev.away) continue;
    const game = makeCatalogGame(
      sport,
      rand,
      idx++,
      { key: sportKey, title: ev.tournament || sportKey },
      ev.home,
      ev.away,
      start,
    );
    if (matchDay(game.commence_time, opts.day ?? "any", opts.offset ?? 0)) games.push(game);
    if (games.length >= CATALOG_MAX_GAMES) break;
  }
  return games;
}

export async function generateFallbackGames(
  sport: SportId,
  opts: { leagues?: string[]; day?: string; offset?: number } = {},
): Promise<Game[]> {
  try {
    const { fetchSportyEvents } = await import("@/lib/sportybet");
    const events = await fetchSportyEvents(sport);
    if (events.length > 0) {
      const games = generateCatalogGames(sport, events, opts);
      if (games.length > 0) return games;
    }
  } catch (err) {
    console.error("SportyBet catalog fallback failed:", err);
  }
  return generateMockGames(sport, 30, opts);
}
