import { spawn } from "node:child_process";
import path from "node:path";
import type { Pick, SportyBetResult, SportyOutcome } from "@/lib/types";

const SPORT_IDS: Record<string, string> = {
  soccer: "sr:sport:1",
  basketball: "sr:sport:2",
  tennis: "sr:sport:5",
};

const CATALOG_TTL_MS = 5 * 60_000;
const catalogCache = new Map<string, { at: number; events: SportyEvent[] }>();

export interface SportyEvent {
  eventId: string;
  home: string;
  away: string;
  startTime: number;
  tournament: string;
}

export function sportyEnabled(): boolean {
  return true;
}

/**
 * SportyBet's WAF blocks plain HTTP clients via TLS fingerprinting, so the
 * booking calls run through a small sidecar (scripts/sportybet_api.py) that
 * impersonates Chrome. Locally we spawn it; in production (e.g. Vercel, where
 * spawning a venv python is not possible) set SPORTYBET_SIDECAR_URL to a
 * hosted instance of scripts/sportybet_server.py and it is called over HTTP.
 */
function sidecarUrl(): string | null {
  const raw = process.env.SPORTYBET_SIDECAR_URL;
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

function sidecarPath(): string {
  const override = process.env.SPORTYBET_SCRIPT;
  if (override) return override;
  return path.join(process.cwd(), "scripts", "sportybet_api.py");
}

function pythonBin(): string {
  const override = process.env.SPORTYBET_PYTHON;
  if (override) return override;
  return path.join(process.cwd(), ".sportybet-venv", "bin", "python");
}

async function httpSidecar<T = Record<string, unknown>>(
  route: string,
  input?: string,
): Promise<T | null> {
  const base = sidecarUrl();
  if (!base) return null;
  const headers: Record<string, string> = {};
  if (input) headers["Content-Type"] = "application/json";
  if (process.env.SPORTYBET_SIDECAR_TOKEN) {
    headers["x-sidecar-token"] = process.env.SPORTYBET_SIDECAR_TOKEN;
  }
  try {
    const res = await fetch(`${base}${route}`, {
      method: input ? "POST" : "GET",
      headers,
      body: input,
      signal: AbortSignal.timeout(25_000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch (err) {
    console.error("Remote sportybet sidecar failed:", err);
    return null;
  }
}

function runSidecar(args: string[], input?: string): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    try {
      const child = spawn(pythonBin(), [sidecarPath(), ...args], { stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (c) => (stdout += c));
      child.stderr.on("data", (c) => (stderr += c));
      child.on("error", (err) => {
        console.error("SportyBet sidecar spawn error:", err.message);
        resolve(null);
      });
      child.on("close", (code) => {
        if (code !== 0) {
          console.error("SportyBet sidecar exit", code, stderr.slice(0, 400));
          resolve(null);
          return;
        }
        try {
          resolve(JSON.parse(stdout) as Record<string, unknown>);
        } catch {
          resolve(null);
        }
      });
      if (input) child.stdin.write(input);
      child.stdin.end();
    } catch (err) {
      console.error("SportyBet sidecar failed:", err);
      resolve(null);
    }
  });
}

/** Catalog call: remote HTTP sidecar when configured, local spawn otherwise. */
async function sidecarCatalog(sport: string): Promise<Record<string, unknown> | null> {
  const remote = await httpSidecar(`/catalog/${encodeURIComponent(sport)}`);
  if (remote || sidecarUrl()) return remote;
  return runSidecar(["catalog", sport]);
}

/** Booking call: same dual-mode dispatch. */
async function sidecarBook(payload: string): Promise<Record<string, unknown> | null> {
  const remote = await httpSidecar("/book", payload);
  if (remote || sidecarUrl()) return remote;
  return runSidecar(["book"], payload);
}

export async function fetchSportyEvents(sport: string): Promise<SportyEvent[]> {
  const cached = catalogCache.get(sport);
  if (cached && Date.now() - cached.at < CATALOG_TTL_MS) return cached.events;

  const data = await sidecarCatalog(sport);
  if (!data) return [];
  const events = data["events"];
  if (!Array.isArray(events)) return [];
  const out: SportyEvent[] = [];
  for (const e of events as Record<string, unknown>[]) {
    out.push({
      eventId: String(e["eventId"] ?? ""),
      home: String(e["home"] ?? ""),
      away: String(e["away"] ?? ""),
      startTime: typeof e["startTime"] === "number" ? e["startTime"] : 0,
      tournament: String(e["tournament"] ?? ""),
    });
  }
  catalogCache.set(sport, { at: Date.now(), events: out });
  return out;
}

function normalizeTeam(name: string): string {
  let n = name.toLowerCase().trim();
  const subs: Array<[RegExp, string]> = [
    [/\b(fc|cf|sc|ac|kv|jv|sv|vfb|ssc|club|team)\b/g, ""],
    [/manchester/g, "man"],
    [/\bunited\b/g, "utd"],
    [/-/g, " "],
    [/\./g, ""],
  ];
  for (const [re, to] of subs) n = n.replace(re, to);
  return n.replace(/\s+/g, " ").trim();
}

function ratio(a: string, b: string): number {
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0) return n === m ? 1 : 0;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (a[i - 1] === b[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1;
      else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return (2 * dp[n][m]) / (n + m);
}

function sideScore(a: string, b: string): number {
  const na = normalizeTeam(a);
  const nb = normalizeTeam(b);
  const swapped = nb.split(/\s+/).reverse().join(" ");
  return Math.max(ratio(na, nb), ratio(na, swapped));
}

export function matchPickToEvent(pick: Pick, events: SportyEvent[]): SportyEvent | null {
  const pickHome = normalizeTeam(pick.home);
  const pickAway = normalizeTeam(pick.away);
  let best: SportyEvent | null = null;
  let bestScore = 0;
  for (const ev of events) {
    const sideHome = sideScore(pickHome, ev.home);
    const sideAway = sideScore(pickAway, ev.away);
    const score = Math.min(sideHome, sideAway);
    if (score > bestScore) {
      bestScore = score;
      best = ev;
    }
  }
  return bestScore >= 0.55 ? best : null;
}

export interface Selection {
  eventId: string;
  marketId: string;
  outcomeId: string;
  specifier?: string;
}

export function pickToSelection(pick: Pick, event: SportyEvent, sport: string): Selection | null {
  const sel = pick.selection.toLowerCase();
  const home = pick.home.toLowerCase();
  const away = pick.away.toLowerCase();
  const line = pick.selection.match(/(\d+(?:\.\d+)?)/)?.[1];

  if (pick.market === "h2h") {
    if (sport === "soccer") {
      if (sel === home) return { eventId: event.eventId, marketId: "1", outcomeId: "1" };
      if (sel === "draw") return { eventId: event.eventId, marketId: "1", outcomeId: "2" };
      if (sel === away) return { eventId: event.eventId, marketId: "1", outcomeId: "3" };
      return null;
    }
    if (sport === "basketball") {
      if (sel === home) return { eventId: event.eventId, marketId: "219", outcomeId: "4" };
      if (sel === away) return { eventId: event.eventId, marketId: "219", outcomeId: "5" };
      return null;
    }
    if (sport === "tennis") {
      if (sel === home) return { eventId: event.eventId, marketId: "186", outcomeId: "4" };
      if (sel === away) return { eventId: event.eventId, marketId: "186", outcomeId: "5" };
      return null;
    }
    return null;
  }

  if (pick.market === "totals") {
    const isOver = sel.startsWith("over");
    if (sport === "soccer") {
      return {
        eventId: event.eventId,
        marketId: "18",
        outcomeId: isOver ? "12" : "13",
        specifier: `total=${line ?? "2.5"}`,
      };
    }
    if (sport === "basketball") {
      if (!line) return null;
      return {
        eventId: event.eventId,
        marketId: "225",
        outcomeId: isOver ? "12" : "13",
        specifier: `total=${line}`,
      };
    }
    return null;
  }

  if (pick.market === "spreads") {
    const isHome = pick.selection.toLowerCase().startsWith(home);
    const isAway = pick.selection.toLowerCase().startsWith(away);
    if (!isHome && !isAway) return null;
    const signedMatch = pick.selection.match(/([+-]?\d+(?:\.\d+)?)/);
    if (!signedMatch) return null;
    const signedLine = parseFloat(signedMatch[1]);
    const homeLine = isHome ? signedLine : -signedLine;
    if (homeLine === 0 || (homeLine * 2) % 2 === 0) return null;

    if (sport === "soccer") {
      return {
        eventId: event.eventId,
        marketId: "16",
        outcomeId: isHome ? "1714" : "1715",
        specifier: `hcp=${homeLine}`,
      };
    }
    if (sport === "basketball") {
      return {
        eventId: event.eventId,
        marketId: "223",
        outcomeId: isHome ? "1714" : "1715",
        specifier: `hcp=${homeLine}`,
      };
    }
    return null;
  }

  if (sport !== "soccer") return null;

  if (pick.market === "double_chance") {
    const dc: Record<string, string> = {
      "home or draw": "9",
      "home or away": "10",
      "draw or away": "11",
    };
    const outcomeId = dc[sel];
    return outcomeId ? { eventId: event.eventId, marketId: "10", outcomeId } : null;
  }

  if (pick.market === "draw_no_bet") {
    if (sel === home) return { eventId: event.eventId, marketId: "11", outcomeId: "4" };
    if (sel === away) return { eventId: event.eventId, marketId: "11", outcomeId: "5" };
    return null;
  }

  if (pick.market === "btts") {
    if (sel === "yes") return { eventId: event.eventId, marketId: "29", outcomeId: "74" };
    if (sel === "no") return { eventId: event.eventId, marketId: "29", outcomeId: "76" };
    return null;
  }

  if (pick.market === "odd_even") {
    if (sel === "odd") return { eventId: event.eventId, marketId: "26", outcomeId: "70" };
    if (sel === "even") return { eventId: event.eventId, marketId: "26", outcomeId: "72" };
    return null;
  }

  return null;
}

function pickStr(v: unknown): string {
  return typeof v === "string" || typeof v === "number" ? String(v) : "";
}

export async function bookSportyBet(
  picks: { pick: Pick; selection: Selection; sport: string }[],
): Promise<SportyBetResult | null> {
  if (picks.length === 0) return null;

  const selections = picks.map((s) => {
    const sportId = SPORT_IDS[s.sport] ?? "sr:sport:1";
    const sel: Record<string, string> = {
      eventId: s.selection.eventId,
      marketId: s.selection.marketId,
      outcomeId: s.selection.outcomeId,
      sportId,
      label: `${s.pick.home} vs ${s.pick.away} — ${s.pick.selection}`,
    };
    if (s.selection.specifier) sel.specifier = s.selection.specifier;
    return sel;
  });

  const data = await sidecarBook(JSON.stringify({ selections }));
  if (!data) return null;

  const shareCode = pickStr(data["shareCode"]);
  if (!shareCode) return null;

  const outcomesRaw = data["outcomes"];
  const outcomes: SportyOutcome[] = Array.isArray(outcomesRaw)
    ? (outcomesRaw as Record<string, unknown>[]).map((o) => ({
        selection: pickStr(o["selection"]),
        home: pickStr(o["home"]),
        away: pickStr(o["away"]),
        odds: pickStr(o["odds"]),
        tournament: pickStr(o["tournament"]),
        market: pickStr(o["market"]),
      }))
    : [];

  const unavailableRaw = data["unavailable"];
  const unavailable: string[] = Array.isArray(unavailableRaw)
    ? (unavailableRaw as unknown[]).map((u) => (typeof u === "string" ? u : JSON.stringify(u)))
    : [];

  return {
    shareCode,
    shareURL: pickStr(data["shareURL"]),
    deadline: typeof data["deadline"] === "number" ? data["deadline"] : null,
    outcomes,
    unavailable,
  };
}
