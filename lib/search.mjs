/**
 * Swap search that doesn't fool itself. Pure; runs under node --test.
 *
 * Three fixes over "try every one-card swap once and keep the best":
 *   1. Successive halving (explore, then exploit): every candidate gets a few games, the better half gets
 *      twice as many, and so on, so the sim budget goes to the close calls instead of the obvious losers.
 *   2. Pair swaps: two weak cards replaced at once, which can reach decks a one-card-at-a-time climb can't
 *      (the way cutting Leyline and Call together beat cutting either alone).
 *   3. Fresh-seed confirmation: the winner of many noisy comparisons is partly luck (the winner's curse),
 *      so it is replayed on games none of the rounds used before it's recommended.
 *
 * `run(deckText, { games, seed0 })` must return one results array per opponent (1 win, 0 loss, 0.5 draw),
 * with game i using the same shuffles for any deck, so two decks can be compared game by game.
 */
import { BASIC_LANDS, parseList } from "./decklist.mjs";

/** Paired change in win rate, all opponents pooled: b minus a, in win-rate units. */
export function pairedAll(aRuns, bRuns) {
  const a = aRuns.flat();
  const b = bRuns.flat();
  const d = a.map((x, i) => b[i] - x);
  const n = d.length;
  const mean = d.reduce((s, x) => s + x, 0) / n;
  const sd = Math.sqrt(d.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, n - 1));
  return { delta: mean, se: sd / Math.sqrt(n) };
}

/** Apply swaps [{out, in}]: every copy of `out` becomes `in`; counts merge. Returns { text } or { error }. */
export function applySwapSet(mainText, swaps) {
  const rows = new Map(parseList(mainText).cards.map((c) => [c.name, c.qty]));
  for (const { out, in: inn } of swaps) {
    const q = rows.get(out);
    if (!q) return { error: `${out} isn't in the deck.` };
    rows.delete(out);
    rows.set(inn, (rows.get(inn) ?? 0) + q);
  }
  for (const [name, q] of rows) if (q > 4 && !BASIC_LANDS.has(name)) return { error: `${name} would have ${q} copies.` };
  return { text: [...rows].map(([n, q]) => `${q} ${n}`).join("\n") };
}

/** Candidate swap sets: every out × in, plus both outs → the same in (when that stays at 4 copies or fewer). */
export function candidateSwaps(mainText, outs, ins) {
  const qty = new Map(parseList(mainText).cards.map((c) => [c.name, c.qty]));
  const cands = [];
  for (const out of outs) for (const inn of ins) cands.push({ label: `${qty.get(out)} ${inn} for ${out}`, swaps: [{ out, in: inn }] });
  if (outs.length === 2) {
    const total = (qty.get(outs[0]) ?? 0) + (qty.get(outs[1]) ?? 0);
    if (total <= 4) for (const inn of ins) cands.push({ label: `${total} ${inn} for both ${outs.join(" and ")}`, swaps: outs.map((out) => ({ out, in: inn })) });
  }
  return cands.filter((c) => !applySwapSet(mainText, c.swaps).error);
}

/** One halving round: score every candidate on the same games, keep the better share. */
export function halvingRound(mainText, cands, run, { games, seed0, keep = 0.5, minKeep = 2 }) {
  const base = run(mainText, { games, seed0 });
  const scored = cands.map((c) => {
    const { text } = applySwapSet(mainText, c.swaps);
    const p = pairedAll(base, run(text, { games, seed0 }));
    return { ...c, delta: p.delta, se: p.se, games };
  });
  scored.sort((a, b) => b.delta - a.delta);
  const n = Math.max(Math.min(minKeep, scored.length), Math.ceil(scored.length * keep));
  return { scored, survivors: scored.slice(0, n) };
}

/**
 * Replay one candidate on fresh games. Verdict: "holds" if the gain is still more than two standard errors,
 * "close" if it's positive but inside that, "gone" otherwise.
 */
export function confirm(mainText, cand, run, { games, seed0 }) {
  const { text } = applySwapSet(mainText, cand.swaps);
  const p = pairedAll(run(mainText, { games, seed0 }), run(text, { games, seed0 }));
  const verdict = p.delta > 2 * p.se ? "holds" : p.delta > 0 ? "close" : "gone";
  return { ...cand, confirmDelta: p.delta, confirmSe: p.se, verdict, holds: verdict === "holds", shrank: cand.delta != null ? cand.delta - p.delta : null };
}

/** Whole search in one call (for scripts and tests; the app runs the rounds one request at a time). */
export function search(mainText, outs, ins, run, { games0 = 40, rounds = 4, confirmGames = 400, finalists = 2 } = {}) {
  let pool = candidateSwaps(mainText, outs, ins);
  const history = [];
  let games = games0;
  for (let r = 0; r < rounds && pool.length > finalists; r++) {
    const res = halvingRound(mainText, pool, run, { games, seed0: 1 + r * 100003 });
    history.push(res.scored.map(({ label, delta, se }) => ({ label, delta, se })));
    pool = res.survivors;
    games *= 2;
  }
  const checked = pool.slice(0, finalists).map((c) => confirm(mainText, c, run, { games: confirmGames, seed0: 9000001 }));
  return { history, checked };
}
