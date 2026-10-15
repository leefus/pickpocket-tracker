/**
 * Pure match math. No Notion, no React, so it runs under `node --test`.
 */
import { NOT_IN_META, TOP_N, colorCode } from "./meta.mjs";

export const WORST_FLOOR = 0.35;
export const MIN_SAMPLE = 5;

export const won = (m) => m.gamesWon > m.gamesLost;

/** Table row an opponent belongs to. Off-meta decks group by their basic type. */
export const opponentGroup = (m) =>
  m.opponent === NOT_IN_META ? `Off-meta ${m.opponentArchetype ?? "(type not set)"}` : m.opponent;

/** Fuller label for the history list. */
export function opponentLabel(m) {
  if (m.opponent !== NOT_IN_META) return m.opponent;
  const code = colorCode(m.opponentColors);
  const type = [code, m.opponentArchetype].filter(Boolean).join(" ") || "Off-meta";
  return m.opponentName ? `${m.opponentName} (${type})` : `${type} (off-meta)`;
}

/** Wilson score interval, 95%. Honest at small n, unlike p ± 1.96·se. */
export function wilson(k, n, z = 1.96) {
  if (!n) return [0, 0];
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)];
}

export const pct = (x) => (x == null ? "—" : `${(x * 100).toFixed(1)}%`);

const record = (ms) => {
  const w = ms.filter(won).length;
  return { wins: w, losses: ms.length - w, n: ms.length, rate: ms.length ? w / ms.length : null };
};

/** The two matchups a deck's sideboard leans on hardest get a lower bar. */
export function matchupStatus(group, rec, { gateRate, worst }) {
  if (rec.n < MIN_SAMPLE) return { tone: "na", label: rec.n ? "Too few" : "No data" };
  if (rec.rate >= 0.5) return { tone: "good", label: "Favored" };
  const isWorst = worst.includes(group);
  if (rec.rate >= (isWorst ? WORST_FLOOR : gateRate)) return { tone: "warn", label: "Close" };
  return { tone: "bad", label: isWorst ? "Rework sideboard" : "Losing" };
}

export function gate(overall, { gateMatches, gateRate, deckName }) {
  const { n, wins } = overall;
  const [lo, hi] = wilson(wins, n);
  const bar = pct(gateRate).replace(".0%", "%");
  if (n < gateMatches) {
    return {
      tone: "",
      head: "Keep testing.",
      body: n
        ? `At ${pct(wins / n)} over ${n} matches, the 95% range (${pct(lo)}–${pct(hi)}) is still too wide to decide. Log ${gateMatches - n} more.`
        : `Log ${gateMatches} matches before judging ${deckName}. Small samples swing a lot.`,
    };
  }
  if (wins / n >= gateRate) {
    return { tone: "good", head: "The deck clears the gate.", body: `${pct(wins / n)} over ${n} matches, above the ${bar} bar. Use the opponent table to tune the sideboard.` };
  }
  return { tone: "bad", head: "Below the gate.", body: `${pct(wins / n)} over ${n} matches is under the ${bar} bar. Time to rework the deck or switch.` };
}

/**
 * Everything the page shows for one deck.
 * `meta` is the current meta list in order; the first TOP_N always get a row.
 * `worst` names opponents that get the lower 35% bar (from the sideboard guide).
 */
export function summarize(matches, { meta = [], gateMatches = 30, gateRate = 0.45, worst = [], deckName = "this deck" } = {}) {
  const overall = record(matches);
  const games = matches.reduce((a, m) => ({ won: a.won + m.gamesWon, lost: a.lost + m.gamesLost }), { won: 0, lost: 0 });
  const onPlay = record(matches.filter((m) => m.playDraw === "Play"));
  const onDraw = record(matches.filter((m) => m.playDraw === "Draw"));

  const top = meta.slice(0, TOP_N);
  const groups = new Map(top.map((t) => [t, []]));
  for (const m of matches) {
    const k = opponentGroup(m);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(m);
  }
  const order = (g) => {
    const i = meta.indexOf(g);
    return i === -1 ? meta.length + (g.startsWith("Off-meta") ? 1 : 0) : i;
  };
  const byOpponent = [...groups.entries()]
    .map(([group, ms]) => {
      const rec = record(ms);
      return {
        group,
        offMeta: group.startsWith("Off-meta"),
        ...rec,
        play: record(ms.filter((m) => m.playDraw === "Play")),
        draw: record(ms.filter((m) => m.playDraw === "Draw")),
        status: matchupStatus(group, rec, { gateRate, worst }),
      };
    })
    .sort((a, b) => b.n - a.n || order(a.group) - order(b.group) || a.group.localeCompare(b.group));

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
    gate: gate(overall, { gateMatches, gateRate, deckName }),
  };
}

/**
 * Opponents to hold to the lower bar: the first two rows of the deck's
 * sideboard guide, which by convention lists the hardest matchups first.
 */
export const worstFromGuide = (guideRows) => guideRows.slice(0, 2).map((r) => r.opp);
