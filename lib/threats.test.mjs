import test from "node:test";
import assert from "node:assert/strict";
import { bigThreat, cheapAnswer, pAtLeastOne, threatCheck } from "./threats.mjs";

const card = (name, cmc, type, text = "", p, t) => ({ name, cmc, type_line: type, oracle_text: text, power: p, toughness: t });
const cards = [
  card("Get Lost", 2, "Instant", "Destroy target creature, enchantment, or planeswalker."),
  card("Repel Calamity", 2, "Instant", "Destroy target creature with power or toughness 4 or greater."),
  card("Small Kill", 1, "Instant", "Destroy target creature with mana value 2 or less."),
  card("Shock", 1, "Instant", "Shock deals 2 damage to any target."),
  card("Big Kill", 5, "Sorcery", "Destroy target creature."),
  card("Hellkite", 4, "Creature — Dragon", "Flying", "4", "4"),
  card("Bear", 2, "Creature — Bear", "", "2", "2"),
];

test("cheapAnswer: 3 mana or less and able to kill a 5/5 flier", () => {
  assert.deepEqual(cards.filter(cheapAnswer).map((c) => c.name), ["Get Lost", "Repel Calamity"]);
});

test("cheapAnswer: catches 'up to one target', 'non-outlaw' and Turncoat-style exile", () => {
  const extra = [
    card("Lich's Relic", 1, "Artifact — Equipment", "When this Equipment enters, you may pay {2}. When you do, for each opponent, destroy up to one target creature or planeswalker that player controls."),
    card("Shoot the Sheriff", 2, "Instant", "Destroy target non-outlaw creature."),
    card("Turncoat Kunoichi", 3, "Creature — Ninja", "When this creature enters, choose target creature an opponent controls. Exile that creature until this creature leaves the battlefield.", "2", "2"),
  ];
  assert.deepEqual(extra.filter(cheapAnswer).map((c) => c.name), ["Lich's Relic", "Shoot the Sheriff", "Turncoat Kunoichi"]);
});

test("bigThreat: power 4+ creatures costing 5 or less", () => {
  assert.deepEqual(cards.filter(bigThreat).map((c) => c.name), ["Hellkite"]);
});

test("pAtLeastOne: matches the hypergeometric (3 copies, 10 cards ≈ 42.7%)", () => {
  assert.ok(Math.abs(pAtLeastOne(3, 10) - 0.4272) < 0.001);
  assert.equal(pAtLeastOne(0, 10), 0);
});

test("threatCheck: counts our answers and their threats", () => {
  const r = threatCheck("4 Get Lost\n2 Shock\n54 Plains", "2 Repel Calamity", [{ key: "x", name: "Dragons", main: "4 Hellkite\n4 Bear" }], cards);
  assert.equal(r.count, 4);
  assert.equal(r.sideCount, 2);
  assert.equal(r.decks[0].fliers, 4);
});

import { answerGraph, killTest, maxMatching } from "./threats.mjs";

test("killTest: reads conditions on removal", () => {
  const dragon = { cmc: 4, power: "4", toughness: "5", type_line: "Creature — Dragon", oracle_text: "Flying" };
  const bear = { cmc: 2, power: "2", toughness: "2", type_line: "Creature — Bear", oracle_text: "" };
  const kt = (text, cmc = 2) => killTest({ cmc, type_line: "Instant", oracle_text: text });
  assert.equal(kt("Destroy target creature with power or toughness 4 or greater.")(dragon), true);
  assert.equal(kt("Destroy target creature with power or toughness 4 or greater.")(bear), false);
  assert.equal(kt("Destroy target creature with mana value 2 or less.")(dragon), false);
  assert.equal(kt("Destroy target creature with mana value 2 or less.")(bear), true);
  assert.equal(kt("Sear deals 4 damage to target creature or planeswalker.")(dragon), false);
  assert.equal(kt("Draw a card."), null);
});

test("maxMatching: Hall's condition fails when two threats share one answer", () => {
  const r = maxMatching(["A", "B"], new Map([["A", ["x"]], ["B", ["x"]]]));
  assert.equal(r.size, 1);
  assert.equal(r.unmatched.length, 1);
});

test("answerGraph: finds the unanswered threat and the smallest sideboard cover", () => {
  const cards = [
    { name: "Hellkite", cmc: 4, power: "4", toughness: "5", type_line: "Creature — Dragon", oracle_text: "Flying" },
    { name: "Brute", cmc: 3, power: "3", toughness: "3", type_line: "Creature — Ogre", oracle_text: "" },
    { name: "Shock", cmc: 1, type_line: "Instant", oracle_text: "Shock deals 3 damage to any target." },
    { name: "Repel", cmc: 2, type_line: "Instant", oracle_text: "Destroy target creature with power or toughness 4 or greater." },
    { name: "Murder", cmc: 3, type_line: "Instant", oracle_text: "Destroy target creature." },
  ];
  const g = answerGraph("4 Shock\n56 Plains", "2 Repel\n2 Murder", [{ key: "d", name: "Dragons", main: "4 Hellkite\n4 Brute" }], cards);
  const d = g.decks[0];
  assert.deepEqual(d.open, ["Hellkite"]);
  assert.deepEqual(d.cover.cards.map((c) => c.name), ["Repel"]);
  assert.equal(d.matched, 1);
});

test("answerText: own-creature flickers, damaged-only kills and expensive activations aren't cheap answers", () => {
  const mk = (oracle_text, cmc = 1, type_line = "Sorcery") => ({ cmc, type_line, oracle_text });
  assert.equal(cheapAnswer(mk("Exile target creature you control, then return that card to the battlefield.")), false);
  assert.equal(cheapAnswer(mk("When this Case enters, destroy up to one target creature that was dealt damage this turn.", 1, "Enchantment")), false);
  assert.equal(cheapAnswer(mk("{1}: Add one mana of any color.\n{5}, {T}, Sacrifice this artifact: It deals 5 damage to target creature.", 1, "Artifact")), false);
  assert.equal(cheapAnswer(mk("As an additional cost to cast this spell, pay {4} or sacrifice an artifact or creature. Destroy target creature.")), true);
});

test("cheapAnswer: Kitesail Larcenist turning a creature into a Treasure counts as an answer", () => {
  const larc = { cmc: 3, type_line: "Creature — Human Pirate", oracle_text: "Flying, ward {1}\nWhen this creature enters, for each player, choose up to one other target artifact or creature that player controls. For as long as this creature remains on the battlefield, the chosen permanents become Treasure artifacts with \"{T}, Sacrifice this artifact: Add one mana of any color\" and lose all other abilities." };
  assert.equal(cheapAnswer(larc), true);
});
