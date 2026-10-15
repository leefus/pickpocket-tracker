/**
 * Pure match math. No Notion, no React, so it runs under `node --test`.
 */
import { TOP5, WORST } from "./deck.mjs";

export const GATE_MATCHES = 30;
export const GATE_WIN_RATE = 0.45;
export const WORST_FLOOR = 0.35;
export const MIN_SAMPLE = 5;

export const won = (m) => m.gamesWon > m.gamesLost;
export const oppName = (m) => (m.opponent === "Other" ? m.otherDeck || "Other" : m.opponent);

/** Wilson score interval, 95%. Honest at small n, unlike p ± 1.96·se. */
export function wilson(k, n, z = 1.96) {
  if (!n) return [0, 0];
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)];
}

const record = (ms) => {
  const w = ms.filter(won).length;
  return { wins: w, losses: ms.length - w, n: ms.length, rate: ms.length ? w / ms.length : null };
};

export function matchupStatus(opp, rec) {
  if (rec.n < MIN_SAMPLE) return { tone: "na", label: rec.n ? "Too few" : "No data" };
  if (rec.rate >= 0.5) return { tone: "good", label: "Favored" };
  const floor = WORST.includes(opp) ? WORST_FLOOR : GATE_WIN_RATE;
  if (rec.rate >= floor) return { tone: "warn", label: "Close" };
  return { tone: "bad", label: WORST.includes(opp) ? "Rework sideboard" : "Losing" };
}

export function gate(overall) {
  const { n, wins } = overall;
  const [lo, hi] = wilson(wins, n);
  if (n < GATE_MATCHES) {
    return {
      tone: "",
      head: "Keep testing.",
      body: n
        ? `At ${pct(wins / n)} over ${n} matches, the 95% range (${pct(lo)}–${pct(hi)}) is still too wide to decide. Log ${GATE_MATCHES - n} more.`
        : `Log ${GATE_MATCHES} matches before judging the deck. Small samples swing a lot.`,
    };
  }
  if (wins / n >= GATE_WIN_RATE) {
    return {
      tone: "good",
      head: "The deck clears the gate.",
      body: `${pct(wins / n)} over ${n} matches. Keep it, and use the opponent table to tune the sideboard.`,
    };
  }
  return {
    tone: "bad",
    head: "Below the gate.",
    body: `${pct(wins / n)} over ${n} matches is under 45%. Switch to stock Orzhov Life Gain with Lich's Relic and Bitter Triumph added.`,
  };
}

export const pct = (x) => (x == null ? "—" : `${(x * 100).toFixed(1)}%`);

export function summarize(matches) {
  const overall = record(matches);
  const games = matches.reduce(
    (a, m) => ({ won: a.won + m.gamesWon, lost: a.lost + m.gamesLost }),
    { won: 0, lost: 0 },
  );
  const onPlay = record(matches.filter((m) => m.playDraw === "Play"));
  const onDraw = record(matches.filter((m) => m.playDraw === "Draw"));

  const groups = new Map(TOP5.map((t) => [t, []]));
  for (const m of matches) {
    const k = oppName(m);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(m);
  }
  const byOpponent = [...groups.entries()]
    .map(([opp, ms]) => {
      const rec = record(ms);
      return {
        opp,
        ...rec,
        play: record(ms.filter((m) => m.playDraw === "Play")),
        draw: record(ms.filter((m) => m.playDraw === "Draw")),
        status: matchupStatus(opp, rec),
      };
    })
    .sort((a, b) => b.n - a.n || rank(a.opp) - rank(b.opp));

  const deadCounts = new Map();
  for (const m of matches) if (m.deadCard) deadCounts.set(m.deadCard, (deadCounts.get(m.deadCard) ?? 0) + 1);
  const deadCards = [...deadCounts.entries()]
    .map(([card, count]) => ({ card, count, share: count / overall.n }))
    .sort((a, b) => b.count - a.count || a.card.localeCompare(b.card));

  return {
    overall,
    interval: wilson(overall.wins, overall.n),
    games,
    onPlay,
    onDraw,
    byOpponent,
    deadCards,
    gate: gate(overall),
  };
}

const rank = (opp) => {
  const i = TOP5.indexOf(opp);
  return i === -1 ? TOP5.length : i;
};
