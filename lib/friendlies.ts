import { FRIENDLIES_KEY, FRIENDLIES_TITLE } from "@/lib/sports";
import type { Bookmaker, Game, OddsMarket } from "@/lib/types";

const API_BASE = "https://v3.football.api-sports.io";
const MAX_FRIENDLIES = 3;
const TTL_MS = 5 * 60_000;

let cache: { at: number; games: Game[] } | null = null;

interface AfFixture {
  fixture: { id: number; date: string; status: { short: string } };
  league: { id: number };
  teams: { home: { name: string }; away: { name: string } };
}

interface AfBookmaker {
  id: number;
  name: string;
  bets?: { name: string; values?: { value: string; odd: string }[] }[];
}

function afKey(): string | undefined {
  return process.env.APIFOOTBALL_KEY;
}

async function afJson<T>(path: string): Promise<T | null> {
  const key = afKey();
  if (!key) return null;
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { "x-apisports-key": key },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { results?: number; errors?: Record<string, unknown>; response?: unknown };
    if (!data || (data.errors && Object.keys(data.errors).length > 0)) return null;
    return data as T;
  } catch (err) {
    console.error("API-Football friendlies request failed:", err);
    return null;
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array<R>(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

function gameFromFixture(fixture: AfFixture, odds: { bookmakers?: AfBookmaker[] } | null): Game | null {
  if (!odds || !Array.isArray(odds.bookmakers)) return null;
  const home = fixture.teams.home.name;
  const away = fixture.teams.away.name;
  const bookmakers: Bookmaker[] = [];

  for (const bm of odds.bookmakers) {
    const mkts: OddsMarket[] = [];
    const bets = bm.bets ?? [];

    const mw = bets.find((b) => b.name === "Match Winner");
    if (mw) {
      const v = mw.values ?? [];
      const ho = v.find((x) => x.value === "Home");
      const dr = v.find((x) => x.value === "Draw");
      const ao = v.find((x) => x.value === "Away");
      if (ho && dr && ao) {
        mkts.push({
          key: "h2h",
          outcomes: [
            { name: home, price: Number(ho.odd) },
            { name: "Draw", price: Number(dr.odd) },
            { name: away, price: Number(ao.odd) },
          ],
        });
      }
    }

    const ou = bets.find((b) => b.name === "Goals Over/Under");
    if (ou) {
      const over: { name: string; price: number; point: number }[] = [];
      const under: { name: string; price: number; point: number }[] = [];
      for (const x of ou.values ?? []) {
        const m = /^(Over|Under)\s+(\d+(?:\.\d+)?)$/.exec(x.value);
        if (!m) continue;
        const line = parseFloat(m[2]);
        if ((line * 2) % 2 !== 1) continue;
        const target = m[1] === "Over" ? over : under;
        target.push({ name: m[1], price: Number(x.odd), point: line });
      }
      if (over.length > 0 && under.length > 0) {
        over.sort((a, b) => a.point - b.point);
        under.sort((a, b) => a.point - b.point);
        mkts.push({ key: "totals", outcomes: [...over, ...under] });
      }
    }

    if (mkts.length > 0) {
      bookmakers.push({ key: String(bm.id), title: bm.name, markets: mkts });
    }
  }

  if (bookmakers.length === 0) return null;

  return {
    id: String(fixture.fixture.id),
    sport_key: FRIENDLIES_KEY,
    sport_title: FRIENDLIES_TITLE,
    commence_time: fixture.fixture.date,
    home_team: home,
    away_team: away,
    bookmakers,
  };
}

function shiftDate(dateIso: string, days: number): string {
  return new Date(new Date(`${dateIso}T12:00:00`).getTime() + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

async function fetchFriendliesFixtures(): Promise<AfFixture[]> {
  const leagueId = Number(process.env.FRIENDLIES_LEAGUE_ID ?? "667");

  const utcToday = new Date().toISOString().slice(0, 10);
  const dates: string[] = [];
  for (let i = -1; i <= 1; i++) {
    const d = shiftDate(utcToday, i);
    if (!dates.includes(d)) dates.push(d);
  }

  const results = await mapLimit(dates, 3, (date) =>
    afJson<{ response?: AfFixture[] }>(`/fixtures?date=${date}`),
  );

  const seen = new Map<number, AfFixture>();
  for (const r of results) {
    for (const f of r?.response ?? []) {
      if (!f || !f.fixture?.id || f.league?.id !== leagueId) continue;
      if (!f.teams?.home?.name || !f.teams?.away?.name) continue;
      seen.set(f.fixture.id, f);
    }
  }

  return [...seen.values()]
    .sort((a, b) => a.fixture.date.localeCompare(b.fixture.date))
    .slice(0, MAX_FRIENDLIES);
}

export async function fetchFriendliesGames(): Promise<Game[]> {
  if (!afKey()) return [];
  if (cache && Date.now() - cache.at < TTL_MS) return cache.games;

  const fixtures = await fetchFriendliesFixtures();
  if (fixtures.length === 0) {
    cache = { at: Date.now(), games: [] };
    return [];
  }

  const oddsResults = await mapLimit(fixtures, 3, async (f) => {
    const data = await afJson<{ response?: { bookmakers?: AfBookmaker[] }[] }>(`/odds?fixture=${f.fixture.id}`);
    return { fixture: f, odds: data?.response?.[0] ?? null };
  });

  const games = oddsResults
    .map(({ fixture, odds }) => gameFromFixture(fixture, odds))
    .filter((g): g is Game => g !== null);

  cache = { at: Date.now(), games };
  return games;
}
