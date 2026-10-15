import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { CATEGORIES, jonesDeck, scoreCard, tierOf } from "./jones.mjs";
import { parseEdges, deckVertices } from "./graph.mjs";

const load = (f) => JSON.parse(fs.readFileSync(new URL(f, import.meta.url), "utf8"));
const pp = load("./fixtures-pickpocket-cards.json");
const iz = load("./fixtures-izzet-cards.json");
const mc = load("./fixtures-meta-cards.json");
const md = load("./fixtures-meta-decks.json");
const card = (pool, name) => pool.find((c) => c.name.startsWith(name));

const PICKPOCKET = `3 Liliana the Faultless\n3 Tinybones, the Pickpocket\n4 Rank Rat\n2 Black Widow, Super Spy\n1 Reno and Rude\n1 Nita, Forum Conciliator\n2 Ambrosia Whiteheart\n3 Tinybones, Pocket Nuisance\n2 Rescue Girl, First Responder\n2 Hostile Investigator\n3 Tinybones Joins Up\n1 The Seriema\n4 Lich's Relic\n2 Sheltered by Ghosts\n4 Bitter Triumph\n4 Godless Shrine\n4 Concealed Courtyard\n3 Shattered Sanctum\n2 Bleachbone Verge\n2 Multiversal Passage\n5 Swamp\n3 Plains`;
const IZZET = `4 Burst Lightning\n4 Eddymurk Crab\n2 Get Out\n4 Hearth Elemental\n2 Impractical Joke\n6 Island\n4 Opt\n4 Prismari Charm\n4 Riverpyre Verge\n1 Sear\n4 Sleight of Hand\n1 Spell Pierce\n2 Spell Snare\n4 Spirebluff Canal\n4 Steam Vents\n1 Stormcarved Coast\n4 Sunderflock\n1 Thundering Falls\n4 Traumatic Critique`;

test("cards score in the right categories, with reasons", () => {
  const nuisance = scoreCard(card(pp, "Tinybones, Pocket Nuisance"));
  assert.ok(nuisance.scores.disruption > 0 && nuisance.scores.annoyance > 0);
  assert.ok(nuisance.why.includes("pings them over and over"));
  const pick = scoreCard(card(pp, "Tinybones, the Pickpocket"));
  assert.ok(pick.why.includes("uses their own cards against them"));
  assert.ok(scoreCard(card(iz, "Sunderflock")).why.includes("wipes their board"));
  assert.ok(scoreCard(card(mc, "Magmatic Hellkite")).why.includes("destroys their lands"));
  assert.ok(scoreCard(card(mc, "Voice of Victory")).why.includes("shuts things off"));
  assert.equal(scoreCard(card(mc, "Llanowar Elves")).why.length, 0); // a mana elf bothers nobody
});

test("misery graph: discard + theft compounds (your own cards against you)", () => {
  const j = jonesDeck(PICKPOCKET, pp);
  const key = (e) => [e.a, e.b].sort().join("|");
  const keys = new Set(j.edges.map(key));
  assert.ok(keys.has(["Rank Rat", "Tinybones, the Pickpocket"].sort().join("|")));
  const names = deckVertices(PICKPOCKET).map((v) => v.name);
  assert.deepEqual(parseEdges(j.edgesText, names).problems, []); // valid for the graph component
});

test("index, tiers and the ranking of the six decks", () => {
  const idx = {
    pickpocket: jonesDeck(PICKPOCKET, pp).index,
    izzet: jonesDeck(IZZET, iz).index,
    ...Object.fromEntries(Object.entries(md).map(([k, d]) => [k, jonesDeck(d.main, mc).index])),
  };
  for (const v of Object.values(idx)) assert.ok(v >= 0 && v <= 100);
  // Discard-and-steal is the saltiest; a mana-elf landfall deck is the friendliest.
  assert.equal(Math.max(...Object.values(idx)), idx.pickpocket);
  assert.equal(Math.min(...Object.values(idx)), idx.landfall);
  assert.ok(idx.dimir > idx.jund);
  assert.equal(tierOf(0), "Kitchen-table friendly");
  assert.equal(tierOf(79), "Scoop-inducing");
  assert.equal(tierOf(100), "Jeff has left the table");
  assert.equal(CATEGORIES.length, 4);
});

test("compounding grows with the square root of the pairs, so it can't swamp the cards", () => {
  const j = jonesDeck(PICKPOCKET, pp);
  assert.ok(j.compounding < j.raw / 2);
  assert.ok(Math.abs(j.compounding - 3 * Math.sqrt(j.edges.length)) < 0.1);
});
