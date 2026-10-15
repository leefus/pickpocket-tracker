import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { benefitOf, fuelKinds, pressureTable, profileDeck, scoreCard, selfHarm, unitCost } from "./axes.mjs";

const load = (f) => JSON.parse(fs.readFileSync(new URL(f, import.meta.url), "utf8"));
const pp = load("./fixtures-pickpocket-cards.json");
const mc = load("./fixtures-meta-cards.json");
const md = load("./fixtures-meta-decks.json");
const card = (pool, name) => pool.find((c) => c.name.startsWith(name));
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

const PICKPOCKET = `3 Liliana the Faultless\n3 Tinybones, the Pickpocket\n4 Rank Rat\n2 Black Widow, Super Spy\n1 Reno and Rude\n1 Nita, Forum Conciliator\n2 Ambrosia Whiteheart\n3 Tinybones, Pocket Nuisance\n2 Rescue Girl, First Responder\n2 Hostile Investigator\n3 Tinybones Joins Up\n1 The Seriema\n4 Lich's Relic\n2 Sheltered by Ghosts\n4 Bitter Triumph\n4 Godless Shrine\n4 Concealed Courtyard\n3 Shattered Sanctum\n2 Bleachbone Verge\n2 Multiversal Passage\n5 Swamp\n3 Plains`;

test("a both-ways card scores the sum of its halves (X+Z needs no bonus)", () => {
  // Dream Beavers: "each opponent loses 1 life and you gain 1 life".
  const s = scoreCard(card(mc, "Dream Beavers")).axes.life;
  assert.equal(s.mine, 1);
  assert.equal(s.theirs, 1.5 + 1); // a 1-power flyer's hit (×1.5 evasive) plus the drain
});

test("card text is read on the right axes", () => {
  const joins = scoreCard(card(pp, "Tinybones Joins Up")).axes;
  assert.equal(joins.mill.theirs, 1); // "each mill a card": once, not twice
  assert.equal(joins.life.theirs, 1);
  assert.equal(joins.cards.theirs, 1);
  const rat = scoreCard(card(pp, "Rank Rat")).axes;
  assert.equal(rat.cards.theirs, 1);
  assert.equal(scoreCard(card(pp, "Bitter Triumph")).axes.board.theirs, 1);
  const smaug = scoreCard(card(mc, "Smaug the Magnificent")).axes;
  assert.equal(smaug.life.theirs, 6); // 4 power, flying ×1.5
  assert.equal(smaug.tempo.mine, 1); // Treasure
});

test("costs the deck pays off are fuel; a choice of costs takes the cheaper", () => {
  const pick = profileDeck(PICKPOCKET, pp);
  assert.deepEqual(pick.fuel, ["discard"]);
  const bt = pick.cards.find((c) => c.name === "Bitter Triumph");
  assert.ok(bt.costs.every((c) => c.fuel)); // discard is fuel, so the life option is never paid
  assert.equal(bt.axes.life.cost, 0);
  assert.ok(fuelKinds([card(mc, "Biotech Specialist")]).has("sacrifice"));
});

test("pressure is automatic and Boros Dragons pushes life hardest of the meta decks", () => {
  const field = Object.entries(md).map(([name, d]) => ({ name, profile: profileDeck(d.main, mc) }));
  const pr = pressureTable(field);
  assert.equal(pr.dragons.life, 1);
  for (const k of ["dimir", "landfall", "jund"]) assert.ok(pr[k].life < 1);
});

test("self-harm verdict flips by matchup: Dimir's Bitter Triumph pays discard vs Dragons, life vs slower decks", () => {
  const field = Object.entries(md).map(([name, d]) => ({ name, profile: profileDeck(d.main, mc) }));
  const pr = pressureTable(field);
  const others = Object.fromEntries(Object.entries(pr).filter(([k]) => k !== "dimir"));
  const bt = selfHarm(field.find((f) => f.name === "dimir").profile, others).find((r) => r.name === "Bitter Triumph");
  const by = Object.fromEntries(bt.vs.map((v) => [v.opp, v]));
  assert.equal(by.dragons.choose, "discard");
  assert.equal(by.landfall.choose, "life");
  near(by.dragons.cost, 0.1); // min(3/20 × 1.0, one card = 0.1)
  // Cost never falls as pressure rises.
  const life3 = { axis: "life", amount: 3 };
  assert.ok(unitCost(life3, 0.3) <= unitCost(life3, 0.9));
  assert.ok(bt.benefit > 0);
  assert.equal(bt.benefit, benefitOf(field.find((f) => f.name === "dimir").profile.cards.find((c) => c.name === "Bitter Triumph")));
});
