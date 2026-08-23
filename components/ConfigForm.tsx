"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import NumberFlow from "@number-flow/react";
import { Check, Dices, Loader2, Target } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ACCUMULATOR_ODDS_PRESETS, DEFAULT_MAX_ODDS, DEFAULT_MIN_ODDS, MARKET_LABELS } from "@/lib/sports";
import type { GenerateResult, League, MarketType, SportId } from "@/lib/types";
import { Results } from "@/components/Results";

const SPORTS: { id: SportId; label: string; icon: string }[] = [
  { id: "soccer", label: "Football", icon: "⚽" },
  { id: "basketball", label: "Basketball", icon: "🏀" },
  { id: "tennis", label: "Tennis", icon: "🎾" },
];

const DAYS: { id: string; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "tomorrow", label: "Tomorrow" },
  { id: "any", label: "All days" },
];

const MARKETS: { id: MarketType; label: string }[] = [
  { id: "h2h", label: MARKET_LABELS.h2h },
  { id: "totals", label: MARKET_LABELS.totals },
  { id: "spreads", label: MARKET_LABELS.spreads },
  { id: "btts", label: `${MARKET_LABELS.btts} (Football)` },
  { id: "double_chance", label: `${MARKET_LABELS.double_chance} (Football)` },
  { id: "draw_no_bet", label: `${MARKET_LABELS.draw_no_bet} (Football)` },
  { id: "odd_even", label: `${MARKET_LABELS.odd_even} (Football)` },
];

const ODDS_PRESETS: { label: string; min: number; max: number }[] = [
  { label: "Safe", min: 1.2, max: 1.8 },
  { label: "Balanced", min: 1.5, max: 3.0 },
  { label: "Value", min: 2.0, max: 5.0 },
  { label: "High", min: 3.0, max: 10.0 },
];

const LOADING_STEPS = [
  "> fetching live odds across sports…",
  "> running expert consensus analysis…",
  "> applying team form & head-to-head intel…",
  "> building your sportybet booking code…",
];

const ODDS_FLOOR = 1.01;
const ODDS_CEIL = 500;

/** Parse a free-typed odds value; anything unreadable falls back. */
function parseOddsEdge(text: string, fallback: number): number {
  const n = Number.parseFloat(text.replace(",", "."));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(ODDS_FLOOR, Math.min(ODDS_CEIL, n));
}

interface FriendlyError {
  title: string;
  detail: string;
}

/** Map API failures / network errors to human copy with an actionable fix. */
function friendlyError(status: number, data: { error?: string; code?: string; suggestion?: string } | null): FriendlyError {
  switch (data?.code) {
    case "NO_GAMES":
      return {
        title: "No fixtures found for that day",
        detail: data.suggestion ?? "Try 'All days', switch day, or relax your league filters.",
      };
    case "ODDS_RANGE_EMPTY":
      return {
        title: `Nothing fits ${data.error?.match(/[\d.]+–[\d.]+/)?.[0] ?? "that odds range"}`,
        detail: data.suggestion ?? "Widen the odds range or add more odds types.",
      };
    case "NOT_ENOUGH_GAMES":
      return {
        title: "Not enough games right now",
        detail: data.suggestion ?? "Lower the pick count or widen the day.",
      };
    case "BAD_CONFIG":
    case "BAD_BODY":
      return {
        title: "Something was off with those settings",
        detail: "Reload the page to reset the form, then try again.",
      };
  }
  if (status === 429) {
    return {
      title: "Rate limited",
      detail: "Too many requests too fast — give it a few seconds and retry.",
    };
  }
  if (status >= 500) {
    return {
      title: "The odds engine hiccuped",
      detail: "That's on us — wait a moment and hit generate again.",
    };
  }
  return {
    title: "Couldn't build your picks",
    detail: data?.suggestion ?? data?.error ?? "Check your settings and try again.",
  };
}

const tap = { scale: 0.97 };

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="tag mb-2 flex items-center gap-1.5 font-bold text-zinc-300">
      <span className="text-ultra-bright">{"//"}</span>
      {children}
    </label>
  );
}

export default function ConfigForm() {
  const [sports, setSports] = useState<SportId[]>(["soccer"]);
  const [markets, setMarkets] = useState<MarketType[]>(["h2h"]);
  const [numPicks, setNumPicks] = useState(3);
  const [mode, setMode] = useState<"single" | "mixed">("mixed");
  // Odds edges are kept as raw text so the field can be freely edited (cleared,
  // mid-typing "1.", pasted "1,5") without breaking state. Numeric values are
  // derived and sanitised; a swapped min/max auto-corrects instead of failing.
  const [minOddsText, setMinOddsText] = useState(String(DEFAULT_MIN_ODDS));
  const [maxOddsText, setMaxOddsText] = useState(String(DEFAULT_MAX_ODDS));
  const [stake, setStake] = useState(1000);
  const [day, setDay] = useState("today");
  const [customDay, setCustomDay] = useState("");
  const [leagues, setLeagues] = useState<Partial<Record<SportId, string[]>>>({});
  const [leagueOptions, setLeagueOptions] = useState<Partial<Record<SportId, League[]>>>({});
  const [loading, setLoading] = useState(false);
  const [targetCombinedOdds, setTargetCombinedOdds] = useState<number | null>(null);
  const [targetOddsEnabled, setTargetOddsEnabled] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GenerateResult | null>(null);

  const minOddsRaw = parseOddsEdge(minOddsText, DEFAULT_MIN_ODDS);
  const maxOddsRaw = parseOddsEdge(maxOddsText, DEFAULT_MAX_ODDS);
  // Effective range: swap if the user inverted the edges.
  const [effMinOdds, effMaxOdds] =
    minOddsRaw <= maxOddsRaw ? [minOddsRaw, maxOddsRaw] : [maxOddsRaw, minOddsRaw];

  /** Canonicalise both fields — runs on blur so what you see is what gets used. */
  function commitOdds() {
    setMinOddsText(String(effMinOdds));
    setMaxOddsText(String(effMaxOdds));
  }

  async function loadLeagues(sport: SportId) {
    try {
      const res = await fetch(`/api/leagues?sport=${sport}`);
      if (!res.ok) return;
      const data = (await res.json()) as { leagues: League[] };
      if (!Array.isArray(data.leagues)) return;
      setLeagueOptions((prev) => ({ ...prev, [sport]: data.leagues }));
      setLeagues((prev) => {
        if (prev[sport] && prev[sport]!.length > 0) return prev;
        return { ...prev, [sport]: data.leagues.slice(0, 4).map((l) => l.key) };
      });
    } catch {
      /* leave leagues unset */
    }
  }

  useEffect(() => {
    (["soccer", "basketball", "tennis"] as SportId[]).forEach((s) => loadLeagues(s));
  }, []);

  function toggleSport(sport: SportId) {
    setSports((prev) => {
      if (prev.includes(sport)) {
        return prev.length > 1 ? prev.filter((s) => s !== sport) : prev;
      }
      // Basketball legs are overs-only — totals must stay selected for them.
      if (sport === "basketball") setMarkets((m) => (m.includes("totals") ? m : [...m, "totals"]));
      return [...prev, sport];
    });
  }

  function toggleMarket(m: MarketType) {
    setMarkets((prev) => {
      if (prev.includes(m)) {
        const next = prev.filter((x) => x !== m);
        return next.length > 0 ? next : prev;
      }
      return [...prev, m];
    });
  }

  function toggleLeague(sport: SportId, key: string) {
    setLeagues((prev) => {
      const current = prev[sport] ?? [];
      if (current.includes(key)) {
        return { ...prev, [sport]: current.filter((k) => k !== key) };
      }
      return { ...prev, [sport]: [...current, key] };
    });
  }

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setLoading(true);
    setLoadingStep(0);
    const timer = setInterval(() => {
      setLoadingStep((s) => Math.min(s + 1, LOADING_STEPS.length - 1));
    }, 1600);
    const effectiveDay = day === "custom" ? customDay : day;
    const tzOffset = -new Date().getTimezoneOffset();
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sports,
          markets,
          numPicks,
          mode,
          minOdds: effMinOdds,
          maxOdds: effMaxOdds,
          stake,
          day: effectiveDay,
          tzOffset,
          leagues,
          ...(targetOddsEnabled && targetCombinedOdds ? { targetCombinedOdds } : {}),
        }),
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : null;
      if (!res.ok) {
        const friendly = friendlyError(res.status, data);
        setError(`${friendly.title} — ${friendly.detail}`);
        toast.error(friendly.title, { description: friendly.detail });
        return;
      }
      setResult(data);
      toast.success("Picks are ready", {
        description:
          data.sporty?.shareCode
            ? `Booking code ${data.sporty.shareCode} is live.`
            : `${data.picks?.length ?? 0} picks generated.`,
      });
    } catch {
      setError(
        "Can't reach the analysis server — check that `npm run dev` is still running, refresh this page, and try again.",
      );
      toast.error("Connection error", {
        description: "The dev server didn't respond. Restart it and refresh.",
      });
    } finally {
      clearInterval(timer);
      setLoading(false);
    }
  }

  const sportCfg = (s: SportId) => SPORTS.find((x) => x.id === s)!;

  // ── one-tap strategy recipes ──
  const RECIPES: { id: string; emoji: string; label: string; apply: () => void }[] = [
    {
      id: "bankers",
      emoji: "🏦",
      label: "Banker Treble",
      apply: () => {
        setSports(["soccer"]);
        setMarkets(["h2h", "double_chance"]);
        setNumPicks(3);
        setMode("mixed");
        setMinOddsText("1.2");
        setMaxOddsText("1.8");
      },
    },
    {
      id: "goals",
      emoji: "🥅",
      label: "Goals Special",
      apply: () => {
        setSports(["soccer"]);
        setMarkets(["totals", "btts"]);
        setNumPicks(4);
        setMode("mixed");
        setMinOddsText("1.4");
        setMaxOddsText("2.4");
      },
    },
    {
      id: "overs",
      emoji: "🏀",
      label: "Overs Machine",
      apply: () => {
        setSports(["basketball"]);
        setMarkets(["totals"]);
        setNumPicks(6);
        setMode("mixed");
        setMinOddsText("1.3");
        setMaxOddsText("2.2");
      },
    },
    {
      id: "moonshot",
      emoji: "🌙",
      label: "Moonshot",
      apply: () => {
        setSports(["soccer", "basketball"]);
        setMarkets(["h2h", "totals"]);
        setNumPicks(10);
        setMode("mixed");
        setMinOddsText("2");
        setMaxOddsText("6");
      },
    },
  ];

  function applyRecipe(recipe: (typeof RECIPES)[number]) {
    recipe.apply();
    setTargetOddsEnabled(false);
    toast.info(`Recipe loaded — ${recipe.label}`, {
      description: "Tweak anything you like, then generate.",
    });
  }

  // rough combined-odds estimate from the current odds range (geometric mean)
  const estCombined = Math.pow(Math.sqrt(effMinOdds * effMaxOdds), numPicks);
  const fmtCompact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-16 xl:max-w-6xl">
      <motion.form
        onSubmit={handleGenerate}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
        className="brd relative bg-panel p-4 hard sm:p-6 md:p-8"
      >
        <span
          aria-hidden
          className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-ultra via-hex to-ultra"
        />
        <div className="mb-6 flex flex-wrap items-center justify-between gap-2 border-b-2 border-dashed border-white/20 pb-4">
          <span className="sticker bg-ultra text-black">config</span>
          <span className="tag text-zinc-300">
            {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
          </span>
        </div>

        {/* ── quick recipes ── */}
        <div className="mb-6 brd border-dashed p-3.5">
          <FieldLabel>
            quick recipes <span className="font-normal text-zinc-300">(one-tap setups)</span>
          </FieldLabel>
          <div className="flex flex-wrap gap-2">
            {RECIPES.map((r) => (
              <motion.button
                key={r.id}
                type="button"
                whileTap={tap}
                onClick={() => applyRecipe(r)}
                className="brd press press-ink inline-flex items-center gap-1.5 px-3 py-1.5 font-mono text-xs font-bold uppercase text-zinc-200 transition-colors hover:border-ultra hover:text-ultra-bright"
              >
                <span aria-hidden>{r.emoji}</span>
                {r.label}
              </motion.button>
            ))}
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <FieldLabel>sports <span className="font-normal text-zinc-300">(combine freely)</span></FieldLabel>
            <div className="grid grid-cols-3 gap-2">
              {SPORTS.map((s) => (
                <motion.button
                  key={s.id}
                  type="button"
                  whileTap={tap}
                  onClick={() => toggleSport(s.id)}
                  className={cn(
                    "brd press press-ink flex flex-col items-center gap-1.5 px-3 py-3.5 text-sm font-bold transition-colors",
                    sports.includes(s.id)
                      ? "bg-ultra text-black"
                      : "bg-transparent text-zinc-300 hover:text-ultra-bright",
                  )}
                >
                  <span className="text-lg">{s.icon}</span>
                  {s.label}
                </motion.button>
              ))}
            </div>
          </div>

          <div>
            <FieldLabel>game day</FieldLabel>
            <div className="grid grid-cols-3 gap-2">
              {DAYS.map((d) => (
                <motion.button
                  key={d.id}
                  type="button"
                  whileTap={tap}
                  onClick={() => setDay(d.id)}
                  className={cn(
                    "brd press press-ink px-3 py-2.5 text-sm font-bold transition-colors",
                    day === d.id
                      ? "bg-ultra text-black"
                      : "bg-transparent text-zinc-300 hover:text-ultra-bright",
                  )}
                >
                  {d.label}
                </motion.button>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <input
                type="date"
                value={customDay}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(e) => {
                  setCustomDay(e.target.value);
                  if (e.target.value) setDay("custom");
                }}
                className="brd min-w-0 bg-transparent px-3 py-2 font-mono text-base outline-none transition-colors focus:border-ultra focus:bg-ultra/10 sm:text-sm"
              />
              <span className="tag shrink-0 text-zinc-300">or exact date</span>
            </div>
          </div>

          <div className="md:col-span-full">
            <FieldLabel>odds types</FieldLabel>
            {sports.includes("basketball") && (
              <p className="mb-2 inline-block bg-ultra/15 px-2 py-1 font-mono text-[11px] text-ultra-bright">
                basketball locked to OVERS — every basketball leg is an Over (full game), scanned
                from the whole board
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {MARKETS.map((m) => {
                const active = markets.includes(m.id);
                return (
                  <motion.button
                    key={m.id}
                    type="button"
                    whileTap={tap}
                    onClick={() => toggleMarket(m.id)}
                    className={cn(
                      "brd inline-flex items-center gap-1.5 px-3 py-1.5 font-mono text-xs font-bold uppercase tracking-wide transition-colors",
                      active
                        ? "press bg-ultra text-black hard-sm"
                        : "border-white/30 bg-transparent text-zinc-300 hover:border-ultra hover:text-ultra-bright",
                    )}
                  >
                    {active && <Check className="h-3.5 w-3.5" />}
                    {m.label}
                  </motion.button>
                );
              })}
            </div>
          </div>

          <div>
            <FieldLabel>picks <span className="text-ultra-bright"><NumberFlow value={numPicks} /></span></FieldLabel>
            <input
              type="range"
              min={1}
              max={100}
              value={numPicks}
              onChange={(e) => setNumPicks(Number(e.target.value))}
              style={{ "--fill": `${((numPicks - 1) / 99) * 100}%` } as React.CSSProperties}
              className="w-full"
            />
            <div className="mt-1.5 flex justify-between font-mono text-[11px] uppercase text-zinc-300">
              <span>1 · safest</span>
              <span>100 · mega acca</span>
            </div>
            <p className="mt-1 font-mono text-[11px] text-zinc-300">
              rough combined @ these odds ≈{" "}
              <span className="font-bold text-ultra-bright">{fmtCompact.format(estCombined)}x</span> over{" "}
              {numPicks} {numPicks === 1 ? "leg" : "legs"}
            </p>
          </div>

          <div>
            <FieldLabel>bet type</FieldLabel>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { id: "single", label: "Singles" },
                  { id: "mixed", label: "Accumulator" },
                ] as const
              ).map((opt) => (
                <motion.button
                  key={opt.id}
                  type="button"
                  whileTap={tap}
                  onClick={() => setMode(opt.id)}
                  className={cn(
                    "brd press press-ink px-3 py-2.5 text-sm font-bold transition-colors",
                    mode === opt.id
                      ? "bg-ultra text-black"
                      : "bg-transparent text-zinc-300 hover:text-ultra-bright",
                  )}
                >
                  {opt.label}
                </motion.button>
              ))}
            </div>
          </div>

          <div>
            <FieldLabel>odds range <span className="font-normal text-zinc-300">(min–max, any order)</span></FieldLabel>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                inputMode="decimal"
                value={minOddsText}
                onChange={(e) => setMinOddsText(e.target.value)}
                onBlur={commitOdds}
                className={cn(
                  "brd bg-transparent px-3 py-2 font-mono text-base outline-none transition-colors focus:bg-ultra/10 sm:text-sm",
                  minOddsRaw !== effMinOdds ? "border-hex" : "focus:border-ultra",
                )}
                placeholder={`e.g. ${DEFAULT_MIN_ODDS}`}
                aria-label="Minimum odds"
              />
              <input
                type="text"
                inputMode="decimal"
                value={maxOddsText}
                onChange={(e) => setMaxOddsText(e.target.value)}
                onBlur={commitOdds}
                className={cn(
                  "brd bg-transparent px-3 py-2 font-mono text-base outline-none transition-colors focus:bg-ultra/10 sm:text-sm",
                  maxOddsRaw !== effMaxOdds ? "border-hex" : "focus:border-ultra",
                )}
                placeholder={`e.g. ${DEFAULT_MAX_ODDS}`}
                aria-label="Maximum odds"
              />
            </div>
            {minOddsRaw > maxOddsRaw && (
              <p className="mt-1 font-mono text-[11px] text-ultra-bright">
                ↻ edges were swapped — using {effMinOdds}–{effMaxOdds}
              </p>
            )}
            <div className="mt-2 grid grid-cols-4 gap-2">
              {ODDS_PRESETS.map((p) => (
                <motion.button
                  key={p.label}
                  type="button"
                  whileTap={tap}
                  onClick={() => {
                    setMinOddsText(String(p.min));
                    setMaxOddsText(String(p.max));
                  }}
                  className={cn(
                    "brd px-1 py-1.5 font-mono text-[11px] font-bold uppercase transition-colors",
                    effMinOdds === p.min && effMaxOdds === p.max
                      ? "bg-ultra text-black"
                      : "border-white/30 text-zinc-300 hover:border-ultra hover:text-ultra-bright",
                  )}
                >
                  {p.label}
                </motion.button>
              ))}
            </div>
            <p className="mt-1.5 font-mono text-[11px] text-zinc-300">
              lower odds = safer · low range unlocks safe games
            </p>
          </div>

          {/* ── Accumulated Odds Target ── */}
          <div className="col-span-full brd border-dashed p-4">
            <div className="flex flex-1 min-w-0 items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="tag inline-flex items-center gap-1.5 font-bold text-zinc-200">
                  <Target className="h-4 w-4 text-ultra-bright" />
                  target accumulated odds
                </p>
                <p className="mt-0.5 font-mono text-[11px] text-zinc-300">
                  auto-select picks until combined odds hit your target
                </p>
              </div>
              <button
                type="button"
                id="target-odds-toggle"
                onClick={() => {
                  const next = !targetOddsEnabled;
                  setTargetOddsEnabled(next);
                  if (next && !targetCombinedOdds) setTargetCombinedOdds(50);
                }}
                className={cn(
                  "brd relative inline-flex h-7 w-12 flex-shrink-0 cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ultra",
                  targetOddsEnabled ? "bg-ultra hard-sm" : "bg-zinc-800",
                )}
                role="switch"
                aria-checked={targetOddsEnabled}
              >
                <motion.span
                  layout
                  transition={{ type: "spring", stiffness: 600, damping: 34 }}
                  className={cn(
                    "pointer-events-none absolute top-[3px] h-[18px] w-[18px]",
                    targetOddsEnabled ? "left-[calc(100%-21px)] bg-black" : "left-[3px] bg-white",
                  )}
                />
              </button>
            </div>

            <AnimatePresence initial={false}>
              {targetOddsEnabled && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                  className="overflow-hidden"
                >
                  <div className="mt-4 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {ACCUMULATOR_ODDS_PRESETS.map((p) => (
                        <motion.button
                          key={p.label}
                          type="button"
                          whileTap={tap}
                          onClick={() => setTargetCombinedOdds(p.value)}
                          className={cn(
                            "brd px-3 py-1.5 font-mono text-xs font-bold uppercase transition-colors",
                            targetCombinedOdds === p.value
                              ? "bg-ultra text-black hard-sm"
                              : "border-white/30 text-zinc-300 hover:border-ultra hover:text-ultra-bright",
                          )}
                        >
                          {p.label}
                        </motion.button>
                      ))}
                      <div className="flex items-center gap-1.5">
                        <span className="tag text-zinc-300">custom</span>
                        <input
                          type="number"
                          min={2}
                          step={5}
                          id="target-combined-odds-input"
                          value={targetCombinedOdds ?? ""}
                          onChange={(e) => setTargetCombinedOdds(Number(e.target.value) || null)}
                          className="brd w-24 bg-transparent px-2 py-1 font-mono text-base outline-none transition-colors focus:border-ultra focus:bg-ultra/10 sm:text-sm"
                          placeholder="75"
                        />
                        <span className="tag text-zinc-500">x</span>
                      </div>
                    </div>
                    {targetCombinedOdds && targetCombinedOdds > 1 && (
                      <div className="brd border-ultra/60 bg-ultra/5 px-4 py-3">
                        <p className="font-mono text-xs text-zinc-300">
                          <span className="text-ultra-bright">{targetCombinedOdds}x</span> combined · ₦
                          <NumberFlow value={stake} /> → potential ₦
                          <NumberFlow value={Math.round(stake * targetCombinedOdds)} className="font-bold text-ultra-bright" />
                        </p>
                        <p className="mt-1 font-mono text-[11px] text-zinc-300">
                          analyser stacks enough games to reach the target, safest first.
                        </p>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div>
            <FieldLabel>stake</FieldLabel>
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center font-mono text-zinc-300">₦</span>
              <input
                type="number"
                min="100"
                step="100"
                value={stake}
                onChange={(e) => setStake(Number(e.target.value))}
                className="brd w-full bg-transparent py-2 pl-8 pr-3 font-mono text-base outline-none transition-colors focus:border-ultra focus:bg-ultra/10 sm:text-sm"
              />
            </div>
            <div className="mt-2 grid grid-cols-4 gap-2">
              {[500, 1000, 2000, 5000].map((v) => (
                <motion.button
                  key={v}
                  type="button"
                  whileTap={tap}
                  onClick={() => setStake(v)}
                  className={cn(
                    "brd px-1 py-1.5 font-mono text-[11px] font-bold transition-colors",
                    stake === v
                      ? "bg-ultra text-black"
                      : "border-white/30 text-zinc-300 hover:border-ultra hover:text-ultra-bright",
                  )}
                >
                  {v >= 1000 ? `₦${v / 1000}k` : `₦${v}`}
                </motion.button>
              ))}
            </div>
            <p className="mt-1.5 font-mono text-[11px] text-zinc-300">estimates potential winnings.</p>
          </div>
        </div>

        {sports.length > 0 && (
          <div className="mt-6 space-y-4">
            {sports.map((sport) => {
              const options = leagueOptions[sport] ?? [];
              const selected = leagues[sport] ?? [];
              if (options.length === 0) return null;
              return (
                <motion.div
                  key={sport}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                  className="brd border-dashed p-4"
                >
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <label className="tag font-bold text-zinc-300">
                      <span className="mr-1.5 text-ultra-bright">{"//"}</span>
                      {sportCfg(sport).icon} {sportCfg(sport).label} leagues
                    </label>
                    <motion.button
                      type="button"
                      whileTap={tap}
                      onClick={() => setLeagues((prev) => ({ ...prev, [sport]: [] }))}
                      className={cn(
                        "brd px-2.5 py-1 font-mono text-[11px] font-bold uppercase transition-colors",
                        selected.length === 0
                          ? "bg-ultra text-black"
                          : "border-white/30 text-zinc-300 hover:border-ultra hover:text-ultra-bright",
                      )}
                    >
                      all leagues
                    </motion.button>
                  </div>
                  <div className="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto pr-1">
                    {options.map((l) => {
                      const active = selected.includes(l.key);
                      return (
                        <motion.button
                          key={l.key}
                          type="button"
                          whileTap={tap}
                          onClick={() => toggleLeague(sport, l.key)}
                          className={cn(
                            "inline-flex items-center gap-1 px-2.5 py-1 font-mono text-[11px] font-bold uppercase transition-colors",
                            active
                              ? "brd border-ultra bg-ultra/15 text-ultra-bright"
                              : "border border-white/20 text-zinc-300 hover:border-ultra hover:text-ultra-bright",
                          )}
                        >
                          {active && <Check className="h-3 w-3" />}
                          {l.title}
                        </motion.button>
                      );
                    })}
                  </div>
                  {selected.length > 0 && (
                    <p className="mt-2 font-mono text-[11px] text-zinc-300">
                      {selected.length} selected — picks restricted to these.
                    </p>
                  )}
                </motion.div>
              );
            })}
          </div>
        )}

        <motion.button
          type="submit"
          disabled={loading}
 whileHover={loading ? undefined : { y: -2, x: -2, boxShadow: "6px 6px 0 #f4f4f5" }}
          whileTap={loading ? undefined : { x: 3, y: 3, boxShadow: "0px 0px 0 #f4f4f5" }}
          transition={{ duration: 0.12 }}
          className="btn-shine brd group sticky bottom-3 z-50 mt-6 w-full bg-ultra px-4 py-4 text-sm font-bold uppercase tracking-wide text-black shadow-[4px_4px_0_#f4f4f5] sm:static sm:px-6 sm:text-base disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? (
            <span className="inline-flex items-center gap-2.5">
              <Loader2 className="h-4 w-4 animate-spin" />
              Analyzing…
            </span>
          ) : (
            <span className="inline-flex flex-wrap items-center justify-center gap-2 leading-tight">
              <Dices className="h-5 w-5 shrink-0" />
              Generate my Sporty Code
              {sports.length > 1 && (
                <span className="text-[0.85em] opacity-80">({sports.map((s) => sportCfg(s).label).join("+")})</span>
              )}
            </span>
          )}
        </motion.button>
        <AnimatePresence>
          {loading && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="mt-3 space-y-1.5 border-l-2 border-ultra pl-3">
                {LOADING_STEPS.slice(0, loadingStep + 1).map((step, i) => (
                  <motion.p
                    key={step}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: i === LOADING_STEPS.length - 1 || i < loadingStep ? 0.55 : 1, x: 0 }}
                    className="text-left font-mono text-xs text-ultra-bright"
                  >
                    {step}
                    {i === loadingStep && <span className="animate-blink">▌</span>}
                  </motion.p>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        {error && (
          <motion.p
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="brd mt-4 border-hex bg-hex/10 px-4 py-3 font-mono text-xs text-red-300 hard-hex"
          >
            ERR: {error}
          </motion.p>
        )}
      </motion.form>

      <AnimatePresence>
        {result && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <Results result={result} stake={stake} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
