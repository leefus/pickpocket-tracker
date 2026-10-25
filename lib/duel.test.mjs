import test from "node:test";
import assert from "node:assert/strict";
import { buildDuelDeck, duelModel, matchup, pairedWin, resolveCombat, chooseAttack, coverage } from "./duel.mjs";

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
