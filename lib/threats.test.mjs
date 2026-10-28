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
