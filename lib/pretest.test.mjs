import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { checkPlans, choose, landEntry, pAny, pAtLeast, pColorGivenLands, parseSwapList, pips, pretest, resolveName } from "./pretest.mjs";

const cards = JSON.parse(fs.readFileSync(new URL("./fixtures-pickpocket-cards.json", import.meta.url), "utf8"));
const near = (a, b, eps = 1e-4) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

const MAIN = `3 Liliana the Faultless
3 Tinybones, the Pickpocket
4 Rank Rat
2 Black Widow, Super Spy
1 Reno and Rude
1 Nita, Forum Conciliator
2 Ambrosia Whiteheart
3 Tinybones, Pocket Nuisance
2 Rescue Girl, First Responder
2 Hostile Investigator
3 Tinybones Joins Up
1 The Seriema
4 Lich's Relic
2 Sheltered by Ghosts
4 Bitter Triumph
4 Godless Shrine
4 Concealed Courtyard
3 Shattered Sanctum
2 Bleachbone Verge
2 Multiversal Passage
5 Swamp
3 Plains`;
const SIDE = "4 Get Lost\n2 Clarion Conqueror\n2 Tithing Blade\n2 Shoot the Sheriff\n3 Duress\n1 Requiting Hex\n1 Steel Hellkite";
const GUIDE = `Boros Dragons | 4 Get Lost, 2 Tithing Blade, 2 Shoot the Sheriff | 2 Liliana, 1 The Seriema, 2 Tinybones, the Pickpocket, 2 Hostile Investigator, 1 Nita
Jund Sacrifice | 2 Clarion Conqueror, 2 Get Lost, 1 Steel Hellkite | 2 Liliana, 1 The Seriema, 1 Nita, 1 Reno and Rude`;

test("hypergeometric helpers match the project's Lean-checked numbers", () => {
  near(choose(5, 2), 10, 1e-9);
  near(choose(60, 7), 386206920, 1e-3);
  near(pAny(60, 18, 7), 0.9301); // black on turn 1, fixed sources (Lean: 93%–94%)
  near(pAny(60, 10, 9), 0.8305); // removal by turn 3 (Lean: 83%–84%)
  near(pAny(60, 6, 9), 0.6403); // a thief by turn 3 (Lean: 64%–65%)
  near(pAtLeast(60, 23, 7, 0), 1);
});

test("conditional colour check equals brute-force enumeration on a tiny deck", () => {
  // 6 cards: 2 coloured lands (c), 1 other land (o), 3 spells (s). Draw 3, need 1 coloured given ≥2 lands.
  const deck = ["c", "c", "o", "s", "s", "s"];
  let den = 0;
  let num = 0;
  for (let a = 0; a < 6; a++) for (let b = a + 1; b < 6; b++) for (let c = b + 1; c < 6; c++) {
    const h = [deck[a], deck[b], deck[c]];
    const lands = h.filter((x) => x !== "s").length;
    if (lands < 2) continue;
    den++;
    if (h.includes("c")) num++;
  }
  near(pColorGivenLands(6, 3, 2, 3, 1, 2), num / den, 1e-12);
});

test("mana symbols and land entry rules", () => {
  assert.deepEqual(pips("{1}{W}{B}"), { W: 1, U: 0, B: 1, R: 0, G: 0 });
  assert.deepEqual(pips("{W/B}{2}"), { W: 0, U: 0, B: 0, R: 0, G: 0 });
  const entry = (n) => landEntry(cards.find((c) => c.name === n).oracle_text);
  assert.equal(entry("Godless Shrine"), "life");
  assert.equal(entry("Concealed Courtyard"), "early");
  assert.equal(entry("Shattered Sanctum"), "late");
  assert.equal(entry("Multiversal Passage"), "life");
  assert.equal(entry("Bleachbone Verge"), "untapped");
  assert.equal(landEntry("This land enters tapped.\n{T}: Add {G}."), "tapped");
});

test("swap lists keep commas inside card names; short names resolve only when unique", () => {
  assert.deepEqual(parseSwapList("2 Liliana, 2 Tinybones, the Pickpocket, 1 Nita"), [
    { qty: 2, name: "Liliana" },
    { qty: 2, name: "Tinybones, the Pickpocket" },
    { qty: 1, name: "Nita" },
  ]);
  const pool = ["Liliana the Faultless", "Tinybones, the Pickpocket", "Tinybones, Pocket Nuisance", "Nita, Forum Conciliator"];
  assert.equal(resolveName("Liliana", pool), "Liliana the Faultless");
  assert.equal(resolveName("Nita", pool), "Nita, Forum Conciliator");
  assert.equal(resolveName("Tinybones", pool), null); // ambiguous
});

test("sideboard plan checks catch imbalance, unknown cards and the 4-copy limit", () => {
  assert.deepEqual(checkPlans(GUIDE, MAIN, SIDE).flatMap((p) => p.problems), []);
  const bad = checkPlans("X | 4 Get Lost, 1 Bitter Triumph | 3 Rank Rat, 2 Splitskin Doll", MAIN, SIDE)[0].problems.join(" / ");
  assert.doesNotMatch(bad, /brings in/); // 5 in, 5 out is balanced
  assert.match(bad, /"Bitter Triumph" isn't in the sideboard/);
  assert.match(bad, /"Splitskin Doll" isn't in the main deck/);
  assert.match(checkPlans("X | 4 Get Lost | 3 Rank Rat", MAIN, SIDE)[0].problems[0], /takes out 3/);
  assert.match(checkPlans("X | 1 Get Lost | 1 Tinybones", MAIN, SIDE)[0].problems[0], /could be Tinybones, the Pickpocket or .*use the full name/);
});

test("the Pickpocket deck: report matches the project's hand-checked numbers", () => {
  const r = pretest({ main: MAIN, side: SIDE, guide: GUIDE, cards });
  assert.equal(r.total, 60);
  assert.equal(r.lands, 23);
  assert.deepEqual(r.curve.slice(1, 5).map((c) => c.n), [13, 15, 7, 2]); // Lean: 13/15/7/2
  assert.equal(r.legendaryCreatures, 17); // Lean
  assert.deepEqual(r.missing, []);
  near(r.hands.p2to4, 0.7666); // decklist doc: 76.7%
  const W = r.colors.find((c) => c.color === "W");
  const B = r.colors.find((c) => c.color === "B");
  assert.deepEqual([W.fixed, W.flex, B.fixed, B.flex], [16, 2, 18, 2]); // Passage counted as flexible
  assert.equal(W.worst.name, "The Seriema"); // the WW card is the hardest white cast
  assert.equal(r.interaction.count, 10); // Relic 4 + Bitter Triumph 4 + Sheltered 2 (Nita is not removal)
  near(r.interaction.pT3, 0.8305);
  assert.equal(r.untappedT1, 20); // everything but the 3 slow lands
  assert.equal(r.flags[0].level, "good");
});

test("Izzet Spellementals: cost reducers flagged, 'up to one target' burn counted", () => {
  const izzet = JSON.parse(fs.readFileSync(new URL("./fixtures-izzet-cards.json", import.meta.url), "utf8"));
  const main = `4 Burst Lightning\n4 Eddymurk Crab\n2 Get Out\n4 Hearth Elemental\n2 Impractical Joke\n6 Island\n4 Opt\n4 Prismari Charm\n4 Riverpyre Verge\n1 Sear\n4 Sleight of Hand\n1 Spell Pierce\n2 Spell Snare\n4 Spirebluff Canal\n4 Steam Vents\n1 Stormcarved Coast\n4 Sunderflock\n1 Thundering Falls\n4 Traumatic Critique`;
  const r = pretest({ main, cards: izzet });
  assert.equal(r.lands, 20);
  assert.deepEqual(r.reducers.map((x) => x.name).sort(), ["Eddymurk Crab", "Hearth Elemental", "Sunderflock"]);
  assert.equal(r.interaction.count, 20); // Impractical Joke now counts
  const U = r.colors.find((c) => c.color === "U");
  assert.equal(U.worst.name, "Get Out"); // reducers left out of the colour check
  near(r.hands.p2to4, 0.7174);
  assert.ok(r.flags.some((f) => /get cheaper/.test(f.text)));
});
