import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { autoEdges, isAutoEdges } from "./autoedges.mjs";
import { analyzeDeck, deckVertices, parseEdges } from "./graph.mjs";

const load = (f) => JSON.parse(fs.readFileSync(new URL(f, import.meta.url), "utf8"));
const pickpocketCards = load("./fixtures-pickpocket-cards.json");
const izzetCards = load("./fixtures-izzet-cards.json");
const metaCards = load("./fixtures-meta-cards.json");
const metaDecks = load("./fixtures-meta-decks.json");
const key = (e) => [e.a, e.b].sort().join("|");

const PICKPOCKET = `3 Liliana the Faultless\n3 Tinybones, the Pickpocket\n4 Rank Rat\n2 Black Widow, Super Spy\n1 Reno and Rude\n1 Nita, Forum Conciliator\n2 Ambrosia Whiteheart\n3 Tinybones, Pocket Nuisance\n2 Rescue Girl, First Responder\n2 Hostile Investigator\n3 Tinybones Joins Up\n1 The Seriema\n4 Lich's Relic\n2 Sheltered by Ghosts\n4 Bitter Triumph\n4 Godless Shrine\n4 Concealed Courtyard\n3 Shattered Sanctum\n2 Bleachbone Verge\n2 Multiversal Passage\n5 Swamp\n3 Plains`;
const IZZET = `4 Burst Lightning\n4 Eddymurk Crab\n2 Get Out\n4 Hearth Elemental\n2 Impractical Joke\n6 Island\n4 Opt\n4 Prismari Charm\n4 Riverpyre Verge\n1 Sear\n4 Sleight of Hand\n1 Spell Pierce\n2 Spell Snare\n4 Spirebluff Canal\n4 Steam Vents\n1 Stormcarved Coast\n4 Sunderflock\n1 Thundering Falls\n4 Traumatic Critique`;

test("output is a valid, labelled edge list the graph parser accepts", () => {
  const { text, edges } = autoEdges(PICKPOCKET, pickpocketCards);
  assert.ok(isAutoEdges(text));
  assert.ok(!isAutoEdges("Rank Rat -- Lich's Relic | reviewed"));
  const parsed = parseEdges(text, deckVertices(PICKPOCKET).map((v) => v.name));
  assert.deepEqual(parsed.problems, []);
  assert.equal(parsed.edges.length, edges.length);
  assert.ok(edges.every((e) => e.a !== e.b));
  assert.equal(new Set(edges.map(key)).size, edges.length); // no duplicate pairs
});

test("agrees with the hand-reviewed graphs (high precision, most of the edges)", () => {
  for (const [main, cards, file, minRecall] of [
    [PICKPOCKET, pickpocketCards, "Pickpocket", 0.75],
    [IZZET, izzetCards, "Izzet", 0.85],
  ]) {
    const reviewed = fs.readFileSync(new URL(`./fixtures-${file.toLowerCase()}-edges.txt`, import.meta.url), "utf8");
    const names = deckVertices(main).map((v) => v.name);
    const R = new Set(parseEdges(reviewed, names).edges.map(key));
    const A = new Set(autoEdges(main, cards).edges.map(key));
    const shared = [...A].filter((k) => R.has(k)).length;
    assert.ok(shared / A.size >= 0.9, `${file} precision ${shared / A.size}`);
    assert.ok(shared / R.size >= minRecall, `${file} recall ${shared / R.size}`);
    const g = analyzeDeck(main, autoEdges(main, cards).text);
    assert.equal(g.components.length, 1, `${file} is one engine`);
  }
});

test("specific links on the meta decks", () => {
  const has = (deck, a, b) => autoEdges(metaDecks[deck].main, metaCards).edges.some((e) => key(e) === [a, b].sort().join("|"));
  assert.ok(has("jund", "Greedy Freebooter", "Smaug the Magnificent")); // Treasure → Treasures you control
  assert.ok(has("jund", "Callous Inspector", "Biotech Specialist")); // dies-value body → sacrifice payoff
  assert.ok(has("dragons", "Sarkhan, Dragon Ascendant", "Nova Hellkite")); // tribal
  assert.ok(has("dragons", "Momo, Friendly Flier", "Magmatic Hellkite")); // flyer payoff
  assert.ok(has("dimir", "Dream Beavers", "Kaito, Bane of Nightmares")); // drain + evasion
  assert.ok(has("landfall", "Icetill Explorer", "Sazh's Chocobo")); // extra land drop → landfall
  // Reminder text doesn't count: Shoot the Sheriff can't kill Pirates, it doesn't pay them off.
  assert.ok(!has("dimir", "Spyglass Siren", "Shoot the Sheriff"));
  // Smaug counts Treasures, not any token.
  assert.ok(!has("dragons", "Voice of Victory", "Smaug the Magnificent"));
});
