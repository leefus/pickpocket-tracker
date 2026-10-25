import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { bestSplit, layerValue, deckRoles, applySwaps, timing } from "./roles.mjs";

const cards = JSON.parse(fs.readFileSync(new URL("./fixtures-meta-cards.json", import.meta.url)));
const decks = JSON.parse(fs.readFileSync(new URL("./fixtures-meta-decks.json", import.meta.url)));
const pool = JSON.parse(fs.readFileSync(new URL("./data/standard-pool.json", import.meta.url))).cards;

test("best split matches the Lean check: 12 slots → 9 : 3, 14 → 11 : 3 (in 4-ofs)", () => {
  // the Lean file counts 4-of cards; here we count copies, so 48 copies ↔ 12 cards
  const s12 = bestSplit(48);
  assert.ok(s12.payoffs >= 10 && s12.payoffs <= 14, JSON.stringify(s12));
  assert.equal(Math.round(s12.payoffs / 4), 3);
  assert.equal(Math.round(bestSplit(56).payoffs / 4), 3);
});

test("a free producer base (land drops) shifts the split toward payoffs", () => {
  assert.ok(bestSplit(32, { base: 24 }).payoffs > bestSplit(32).payoffs);
});

test("payoffs saturate, producers don't", () => {
  const P = (n) => [{ copies: n, m: 1, harms: 0 }];
  const v = (p, q) => layerValue(P(p), P(q));
  assert.ok(v(8, 4) - v(4, 4) > v(4, 8) - v(4, 4) - 1e-9 || v(4, 8) - v(4, 4) < v(4, 4) - v(4, 0));
  assert.ok(v(4, 8) - v(4, 4) < v(4, 4) - v(4, 0), "the second payoff adds less than the first");
  assert.ok(Math.abs(v(8, 4) - v(4, 4) - (v(4, 4) - v(0, 4))) < 1e-9, "every producer adds the same");
  assert.equal(timing(1), 1);
});

test("Jund's sacrifice layer: real list is balanced, and candidates come from its colors", () => {
  const r = deckRoles(decks.jund.main, cards, pool);
  const fodder = r.layers.find((l) => l.id === "fodder");
  assert.ok(fodder, "fodder layer found");
  assert.equal(fodder.verdict, "Balanced.");
  assert.ok(fodder.producers.some((m) => m.name === "Greedy Freebooter"));
  const ok = new Set(["B", "R", "G"]);
  for (const c of fodder.candidates.P) assert.ok(pool.find((p) => p.name.split(" // ")[0] === c.name).color_identity.every((x) => ok.has(x)), c.name);
  assert.ok(!fodder.candidates.P.some((c) => c.name === "Greedy Freebooter"), "cards already in the deck aren't candidates");
});

test("landfall counts land drops as producers", () => {
  const r = deckRoles(decks.landfall.main, cards, pool);
  const lf = r.layers.find((l) => l.id === "landfall");
  assert.ok(lf.base >= 36, `land base ${lf.base}`); // 36 lands incl. 8 fetches counting twice
});

test("swaps keep the deck size", () => {
  const out = applySwaps("4 Greedy Freebooter\n56 Swamp", [{ out: "Greedy Freebooter", in: "Cache Grab" }]);
  assert.equal(out.count, 60);
  assert.match(out.text, /^4 Cache Grab/m);
});
