import test from "node:test";
import assert from "node:assert/strict";
import { applySwapSet, candidateSwaps, confirm, halvingRound, pairedAll, search } from "./search.mjs";
import { parseList } from "./decklist.mjs";

// A toy "sim": each game is won with probability equal to the deck's share of Good cards,
// using the same random numbers for every deck so comparisons are paired.
const toyRun = (text, { games, seed0 }) => {
  const cards = parseList(text).cards;
  const good = cards.filter((c) => c.name.startsWith("Good")).reduce((s, c) => s + c.qty, 0);
  const p = 0.3 + good / 60;
  let s = seed0 >>> 0;
  const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  return [Array.from({ length: games }, () => (r() < p ? 1 : 0))];
};
const MAIN = "4 Weak A\n2 Weak B\n4 Good X\n50 Plains";

test("applySwapSet: replaces every copy, merges, refuses a 5th copy", () => {
  assert.equal(applySwapSet(MAIN, [{ out: "Weak B", in: "Good Y" }]).text, "4 Weak A\n4 Good X\n50 Plains\n2 Good Y");
  assert.ok(applySwapSet(MAIN, [{ out: "Weak B", in: "Good X" }]).error);
});

test("candidateSwaps: singles plus the pair swap when it fits in 4 copies", () => {
  const c = candidateSwaps("2 Weak A\n2 Weak B\n56 Plains", ["Weak A", "Weak B"], ["Good Y"]);
  assert.equal(c.length, 3);
  assert.equal(c[2].swaps.length, 2);
});

test("pairedAll: identical decks give exactly zero", () => {
  const a = toyRun(MAIN, { games: 50, seed0: 3 });
  assert.equal(pairedAll(a, a).delta, 0);
});

test("halving + confirm: the swap that adds the most Good cards wins and holds up", () => {
  const cands = candidateSwaps(MAIN, ["Weak A", "Weak B"], ["Good Y", "Meh Z"]);
  const r = halvingRound(MAIN, cands, toyRun, { games: 400, seed0: 1 });
  assert.equal(r.scored[0].label, "4 Good Y for Weak A");
  const c = confirm(MAIN, r.scored[0], toyRun, { games: 2000, seed0: 999 });
  assert.equal(c.holds, true);
  const s = search(MAIN, ["Weak A", "Weak B"], ["Good Y", "Meh Z"], toyRun, { games0: 100, rounds: 2, confirmGames: 1000, finalists: 1 });
  assert.equal(s.checked[0].label, "4 Good Y for Weak A");
});
