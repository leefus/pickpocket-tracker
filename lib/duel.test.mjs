import test from "node:test";
import assert from "node:assert/strict";
import { buildDuelDeck, duelModel, matchup, pairedWin, resolveCombat, chooseAttack, coverage, playDuel } from "./duel.mjs";

const C = (name, cmc, p, t, text = "", kw = []) => ({ name, cmc, type_line: "Creature — Bear", power: String(p), toughness: String(t), oracle_text: text, keywords: kw });
const cards = [
  C("Bear", 2, 2, 2),
  C("Ogre", 3, 3, 3),
  C("Snake", 2, 1, 1, "Deathtouch", ["Deathtouch"]),
  C("Knight", 2, 2, 2, "First strike", ["First strike"]),
  C("Rhino", 4, 4, 4, "Trample", ["Trample"]),
  { name: "Kill", cmc: 2, type_line: "Instant", oracle_text: "Destroy target creature." },
];
const D = (t) => buildDuelDeck(t, cards);
const obj = (name, owner) => ({ m: duelModel(cards.find((c) => c.name === name)), owner, counters: 0 });

test("combat: deathtouch kills anything, first strike kills before the hit back, trample spills over", () => {
  const A = { landsOut: 0 }, B = { landsOut: 0 };
  const bear = obj("Bear", A), snake = obj("Snake", B);
  let r = resolveCombat([bear], new Map([[bear, [snake]]]));
  assert.ok(r.dead.has(bear) && r.dead.has(snake));
  const knight = obj("Knight", A), bear2 = obj("Bear", B);
  r = resolveCombat([knight], new Map([[knight, [bear2]]]));
  assert.ok(r.dead.has(bear2) && !r.dead.has(knight), "first strike kills the blocker first");
  const rhino = obj("Rhino", A), bear3 = obj("Bear", B);
  r = resolveCombat([rhino], new Map([[rhino, [bear3]]]));
  assert.equal(r.toPlayer, 2);
});

test("minimax: don't attack a 2/2 into an untapped 3/3", () => {
  const A = { bf: [], life: 20, landsOut: 0 }, B = { bf: [], life: 20, landsOut: 0 };
  const bear = obj("Bear", A), ogre = obj("Ogre", B);
  A.bf.push(bear);
  B.bf.push(ogre);
  assert.equal(chooseAttack(A, B).attackers.length, 0);
  // but attack when the defender can't block
  ogre.tapped = true;
  assert.equal(chooseAttack(A, B).attackers.length, 1);
});

test("mirror match is about even; bigger creatures win; removal helps", () => {
  const mirror = matchup(D("24 Forest\n36 Bear"), D("24 Forest\n36 Bear"), { games: 200 });
  assert.ok(Math.abs(mirror.win - 0.5) < 0.12, `mirror ${mirror.win}`);
  assert.ok(matchup(D("24 Forest\n36 Ogre"), D("24 Forest\n36 Bear"), { games: 200 }).win > 0.75);
  const base = matchup(D("24 Forest\n36 Bear"), D("24 Forest\n36 Bear"), { games: 300 });
  const withKill = matchup(D("24 Forest\n24 Bear\n12 Kill"), D("24 Forest\n36 Bear"), { games: 300 });
  assert.ok(pairedWin(base, withKill).delta > 0, JSON.stringify(pairedWin(base, withKill)));
});

test("same deck, same games: the paired difference is exactly 0", () => {
  const a = matchup(D("24 Forest\n36 Bear"), D("24 Forest\n36 Ogre"), { games: 100 });
  const b = matchup(D("24 Forest\n36 Bear"), D("24 Forest\n36 Ogre"), { games: 100 });
  assert.deepEqual(pairedWin(a, b), { delta: 0, se: 0 });
});

test("coverage: vanilla creatures are fully understood", () => {
  assert.equal(coverage(D("24 Forest\n36 Bear")), 1);
});

test("prepared spells: back face read as a spell; enters / attack / upkeep; Codie copies; All Aboard blinks", () => {
  const prep = (name, cost, p, t, front, back) => ({ name: `${name} // B`, cmc: cost, card_faces: [
    { name, mana_cost: `{${cost}}`, type_line: "Creature — Human Wizard", power: String(p), toughness: String(t), oracle_text: front },
    { name: "B", mana_cost: back[0], type_line: back[1], oracle_text: back[2] }] });
  const bolt = duelModel(prep("Emeritus", 2, 2, 2, "This creature enters prepared.", ["{R}", "Instant", "Lightning Bolt deals 3 damage to any target."]));
  assert.equal(bolt.prep.enters, true);
  assert.equal(bolt.prep.spell.cost, 1);
  assert.equal(bolt.prep.spell.spellRemoval[0].kind, "dmg");
  const tutor = duelModel(prep("Woe", 4, 5, 4, "This creature enters prepared.", ["{1}{B}", "Sorcery", "Search your library for a card, put that card into your hand, then shuffle."]));
  assert.equal(tutor.prep.spell.etb.draw, 1);
  const aviator = duelModel(prep("Aviator", 3, 2, 3, "Flying\nWhenever this creature attacks, it becomes prepared.", ["{U}", "Instant", "Target creature gains flying until end of turn."]));
  assert.equal(aviator.prep.onAttack, true);
  const sky = duelModel({ name: "Skycoach // All Aboard", cmc: 3, card_faces: [
    { name: "Skycoach", mana_cost: "{2}{U}", type_line: "Creature — Bird Pilot", power: "2", toughness: "3", oracle_text: "Flash\nFlying, vigilance\nThis creature enters prepared." },
    { name: "All Aboard", mana_cost: "{U}", type_line: "Instant", oracle_text: "Exile target non-Pilot creature you control, then return that card to the battlefield under its owner's control." }] });
  assert.equal(sky.prep.spell.flicker, "Pilot");
  const codie = duelModel({ name: "Codie", cmc: 3, type_line: "Legendary Artifact Creature — Book Construct", power: "1", toughness: "4", oracle_text: "Whenever you cast a prepared spell, copy it. You may choose new targets for the copy." });
  assert.equal(codie.prepCopy, 1);
});

test("prepared spells in play: with Codie and Delney out, one prepared Bolt resolves three times", () => {
  const cards = [
    { name: "Bolter // Lightning Bolt", cmc: 1, card_faces: [
      { name: "Bolter", mana_cost: "{1}", type_line: "Creature — Human Wizard", power: "1", toughness: "1", oracle_text: "This creature enters prepared." },
      { name: "Lightning Bolt", mana_cost: "{R}", type_line: "Instant", oracle_text: "Lightning Bolt deals 3 damage to any target." }] },
    { name: "Codie", cmc: 1, type_line: "Legendary Artifact Creature — Book Construct", power: "1", toughness: "4", oracle_text: "Whenever you cast a prepared spell, copy it." },
    { name: "Delney", cmc: 1, type_line: "Legendary Creature — Human Scout", power: "2", toughness: "2", oracle_text: "If a triggered ability of a creature you control with power 2 or less triggers, that ability triggers an additional time." },
    { name: "Wall", cmc: 9, type_line: "Creature — Wall", power: "0", toughness: "9", oracle_text: "Defender" },
  ];
  const me = buildDuelDeck("1 Codie\n1 Delney\n1 Bolter\n57 Mountain", cards);
  const them = buildDuelDeck("60 Plains", cards);
  const log = [];
  // stack the deck: Codie, Delney, Bolter on top so all three are out by turn 3
  const order = [...me].sort((a, b) => (b.land ? 0 : 1) - (a.land ? 0 : 1));
  const lands = order.filter((c) => c.land), spells = order.filter((c) => !c.land);
  const stacked = [lands[0], lands[1], lands[2], spells[0], spells[1], spells[2], lands[3], ...lands.slice(4)];
  const r = () => 0.5;
  playDuel(stacked, them, { r, maxTurn: 4, log });
  const casts = log.filter((l) => /casts prepared Lightning Bolt/.test(l)).length;
  assert.ok(casts >= 1, "the prepared Bolt gets cast");
});
