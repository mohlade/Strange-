import { generateFallbackGames } from "@/lib/mock";
import { fetchFriendliesGames } from "@/lib/friendlies";
import { DEFAULT_LEAGUES, FRIENDLIES_KEY, FRIENDLIES_TITLE, REGIONS, fallbackLeagues } from "@/lib/sports";
import { matchDay, resolveDay } from "@/lib/day";
import type { Game, League, SportId } from "@/lib/types";

const API_BASE = "https://api.the-odds-api.com/v4";

function apiKey(): string | undefined {
  return process.env.ODDS_API_KEY;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { next: { revalidate: 300 } });
  if (!res.ok) {
    throw new Error(`The Odds API responded with ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

interface OddsApiSport {
  key: string;
  active: boolean;
  group: string;
  description: string;
  title: string;
  has_outrights: boolean;
}

let sportsListCache: OddsApiSport[] | null = null;
let sportsListAt = 0;

async function listAvailableSports(): Promise<OddsApiSport[]> {
  if (sportsListCache && Date.now() - sportsListAt < 3_600_000) return sportsListCache;
  const key = apiKey();
  const list = await fetchJson<OddsApiSport[]>(`${API_BASE}/sports/?apiKey=${key}`);
  sportsListCache = list;
  sportsListAt = Date.now();
  return list;
}

export async function listSportLeagues(sport: SportId): Promise<League[]> {
  if (!apiKey()) {
    return fallbackLeagues(sport);
  }
  try {
    const sportCfg = { soccer: "soccer_", basketball: "basketball_", tennis: "tennis_" }[sport];
    const available = await listAvailableSports();
    const popular = DEFAULT_LEAGUES[sport] ?? [];
    const candidates = available
      .filter((s) => s.key.startsWith(sportCfg) && !s.has_outrights)
      .map((s) => ({ key: s.key, title: s.title }))
      .sort((a, b) => {
        const ia = popular.indexOf(a.key);
        const ib = popular.indexOf(b.key);
        if (ia === -1 && ib === -1) return a.title.localeCompare(b.title);
        if (ia === -1) return 1;
        if (ib === -1) return -1;
        return ia - ib;
      });
    if (sport === "soccer" && !candidates.some((c) => c.key === FRIENDLIES_KEY)) {
      candidates.push({ key: FRIENDLIES_KEY, title: FRIENDLIES_TITLE });
    }
    return candidates.length > 0 ? candidates : fallbackLeagues(sport);
  } catch (err) {
    console.error("Failed to list leagues, using defaults:", err);
    return fallbackLeagues(sport);
  }
}

const LEAGUE_FETCH_BATCH = 6;
const DEFAULT_TOP_LEAGUES = 4;
const MAX_LEAGUES_FOR_DAY = 50;

async function fallbackResult(
  sport: SportId,
  prefix: string,
  opts: { leagues?: string[]; day?: string; offset?: number },
): Promise<{ games: Game[]; sportKeys: string[] }> {
  const games = await generateFallbackGames(sport, opts);
  const catalog = games.length > 0 && games.some((g) => g.sport_key.endsWith("_catalog"));
  return { games, sportKeys: [catalog ? "catalog_" + prefix : "mock_" + prefix] };
}

export async function fetchSportGames(
  sport: SportId,
  prefix: string,
  markets: string[],
  opts: { leagues?: string[]; day?: string; offset?: number } = {},
): Promise<{ games: Game[]; sportKeys: string[] }> {
  const key = apiKey();
  const offset = opts.offset ?? 0;
  const day = resolveDay(opts.day ?? "any", offset);
  const requested = opts.leagues ?? [];
  const wantsFriendlies = sport === "soccer" && requested.includes(FRIENDLIES_KEY);
  const otherLeagues = requested.filter((k) => k !== FRIENDLIES_KEY);
  const explicit = requested.length > 0;
  const mockOpts = { leagues: explicit && otherLeagues.length > 0 ? otherLeagues : undefined, day, offset };

  if (!key) {
    if (explicit && otherLeagues.length === 0) {
      return { games: [], sportKeys: ["empty_" + prefix] };
    }
    return fallbackResult(sport, prefix, mockOpts);
  }

  const oddsResult =
    explicit && otherLeagues.length === 0
      ? { games: [], sportKeys: [] }
      : await fetchOddsApiGames(
          sport,
          prefix,
          markets,
          { ...opts, leagues: explicit ? otherLeagues : undefined },
          day,
        );

  let friendlyGames: Game[] = [];
  if (wantsFriendlies) {
    try {
      friendlyGames = await fetchFriendliesGames();
    } catch (err) {
      console.error("Friendlies fetch failed:", err);
    }
  }
  const dayFriendly = friendlyGames.filter((g) => matchDay(g.commence_time, day, offset));

  const sportKeys = [...oddsResult.sportKeys];
  if (wantsFriendlies) {
    sportKeys.push(dayFriendly.length > 0 ? FRIENDLIES_KEY : "empty_" + prefix + "friendlies");
  }

  if (oddsResult.games.length === 0 && dayFriendly.length === 0) {
    if (wantsFriendlies && explicit && otherLeagues.length === 0) {
      return fallbackResult(sport, prefix, mockOpts);
    }
    return { games: [], sportKeys: sportKeys.length > 0 ? sportKeys : ["empty_" + prefix] };
  }
  return { games: [...oddsResult.games, ...dayFriendly], sportKeys };
}

async function fetchOddsApiGames(
  sport: SportId,
  prefix: string,
  markets: string[],
  opts: { leagues?: string[]; day?: string; offset?: number },
  day: string,
): Promise<{ games: Game[]; sportKeys: string[] }> {
  const key = apiKey();
  const offset = opts.offset ?? 0;
  const leaguesExplicit = !!opts.leagues && opts.leagues.length > 0;
  const daySpecific = day !== "any";

  try {
    const available = await listAvailableSports();
    const candidates = available.filter((s) => s.key.startsWith(prefix) && !s.has_outrights);
    const allKeys = candidates.map((c) => c.key);
    if (allKeys.length === 0) {
      if (leaguesExplicit) {
        return { games: [], sportKeys: ["empty_" + prefix] };
      }
      return fallbackResult(sport, prefix, { leagues: opts.leagues, day, offset });
    }

    let leaguesToTry: string[];
    if (leaguesExplicit) {
      leaguesToTry = opts.leagues!.filter((k) => allKeys.includes(k));
      if (leaguesToTry.length === 0) {
        return { games: [], sportKeys: ["empty_" + prefix] };
      }
    } else {
      const popular = DEFAULT_LEAGUES[sport] ?? [];
      const ranked = [...allKeys].sort((a, b) => {
        const ia = popular.indexOf(a);
        const ib = popular.indexOf(b);
        if (ia === -1 && ib === -1) return a.localeCompare(b);
        if (ia === -1) return 1;
        if (ib === -1) return -1;
        return ia - ib;
      });
      leaguesToTry = daySpecific ? ranked.slice(0, MAX_LEAGUES_FOR_DAY) : ranked.slice(0, DEFAULT_TOP_LEAGUES);
    }

    const queriedKeys: string[] = [];
    let anyFulfilled = false;
    const gamesByLeague = new Map<string, Game[]>();

    for (let start = 0; start < leaguesToTry.length; start += LEAGUE_FETCH_BATCH) {
      const batch = leaguesToTry.slice(start, start + LEAGUE_FETCH_BATCH);
      const results = await Promise.allSettled(
        batch.map((sk) =>
          fetchJson<Game[]>(
            `${API_BASE}/sports/${sk}/odds/?apiKey=${key}&regions=${REGIONS}&markets=${markets.join(
              ",",
            )}&oddsFormat=decimal`,
          ),
        ),
      );
      results.forEach((r, i) => {
        const sk = batch[i];
        if (r.status === "fulfilled") {
          anyFulfilled = true;
          const gs = r.value.filter((g) => g.bookmakers.length > 0);
          if (gs.length > 0) {
            gs.forEach((g) => (g.sport_key = g.sport_key || "unknown"));
            gamesByLeague.set(sk, gs);
          }
        }
      });
      queriedKeys.push(...batch);

      if (!daySpecific) break;
      const dayCount = [...gamesByLeague.values()].reduce(
        (a, gs) => a + gs.filter((g) => matchDay(g.commence_time, day, offset)).length,
        0,
      );
      if (dayCount > 0) break;
    }

    if (!anyFulfilled) {
      console.error(`Odds API fetch failed for ${prefix} (quota or network), falling back to demo games`);
      return fallbackResult(sport, prefix, { leagues: opts.leagues, day, offset });
    }

    const games = [...gamesByLeague.values()].flat();
    const dayGames = games.filter((g) => matchDay(g.commence_time, day, offset));

    if (dayGames.length === 0) {
      console.error(
        `No games found for ${prefix} on ${day}, falling back to demo games so picks are still generated`,
      );
      return fallbackResult(sport, prefix, { leagues: opts.leagues, day, offset });
    }
    return { games: dayGames, sportKeys: queriedKeys };
  } catch (err) {
    console.error("Odds API fetch failed, falling back to demo games:", err);
    return fallbackResult(sport, prefix, { leagues: opts.leagues, day, offset });
  }
}
