import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { compile, parseEffect, buildDeck, killTurns, summary, paired, compareSwaps } from "./goldfish.mjs";

const cards = JSON.parse(fs.readFileSync(new URL("./fixtures-meta-cards.json", import.meta.url)));
const decks = JSON.parse(fs.readFileSync(new URL("./fixtures-meta-decks.json", import.meta.url)));
const card = (name) => cards.find((c) => c.name === name);
const fake = (o) => ({ name: o.name, cmc: o.cmc ?? 0, type_line: o.type ?? "Creature — Bear", oracle_text: o.text ?? "", power: o.power ?? null, keywords: o.keywords ?? [] });

test("reads damage, tokens, Treasures and ramp from text", () => {
  assert.equal(parseEffect("This deals 2 damage to any target.").dmg, 2);
  assert.equal(parseEffect("Each opponent loses 3 life.").dmg, 3);
  assert.deepEqual(parseEffect("Create two 1/1 white Soldier creature tokens.").tokens, [1, 1]);
  assert.equal(parseEffect("Create a Treasure token.").treasure, 1);
  assert.equal(parseEffect("Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.").ramp, 1);
  // Erode's land goes to the opponent, not to us
  assert.equal(parseEffect("Destroy target creature or planeswalker. Its controller may search their library for a basic land card, put it onto the battlefield tapped, then shuffle.").ramp, 0);
});

test("models real cards: burn, death triggers, sacrifice outlets, landfall", () => {
  assert.equal(compile(card("Burst Lightning")).etb.dmg, 2);
  const free = compile(card("Greedy Freebooter"));
  assert.equal(free.dies.treasure, 1);
  assert.equal(compile(card("Umbral Collar Zealot")).sacOutlet, true);
  assert.ok(compile(card("Sazh's Chocobo")).triggers.some((t) => t.ev === "land"));
  assert.equal(compile(card("Llanowar Elves")).dork, true);
  assert.equal(compile(card("Erode")).dead, true, "removal with no target does nothing in a goldfish");
});

test("vanilla beats: 24 lands + 36 haste 3/3s for 1 kill on turn 3", () => {
  const bear = fake({ name: "Haste Bear", cmc: 1, power: "3", keywords: ["Haste"] });
  const list = "24 Mountain\n36 Haste Bear";
  const k = killTurns(buildDeck(list, [bear]), { games: 300 });
  assert.ok(summary(k).mean <= 3.6, `mean ${summary(k).mean}`);
});

test("same seeds: a deck compared with itself differs by exactly 0", () => {
  const d = buildDeck(decks.jund.main, cards);
  const a = killTurns(d, { games: 200 }), b = killTurns(d, { games: 200 });
  assert.deepEqual(paired(a, b), { delta: 0, se: 0 });
});

test("swapping a dead card for a real threat makes the deck faster", () => {
  const bear = fake({ name: "Big Bear", cmc: 2, power: "4" });
  const dud = fake({ name: "Dud", cmc: 2, type: "Instant", text: "Destroy target creature." });
  const list = "24 Mountain\n20 Big Bear\n16 Dud";
  const r = compareSwaps(list, [bear, dud, fake({ name: "Bigger Bear", cmc: 2, power: "5" })], { candidates: ["Bigger Bear"], members: ["Dud", "Big Bear"], games: 400 });
  assert.equal(r.results[0].out, "Dud");
  assert.ok(r.results[0].delta < -3 * r.results[0].se, JSON.stringify(r.results[0])); // faster, well outside the noise
});

test("a trigger with a graveyard-count condition isn't treated as always on (Eye of Jace)", () => {
  const eye = { name: "Eye of Jace", cmc: 1, type_line: "Artifact", oracle_text: "At the beginning of your upkeep, surveil 1. Then if there are seven or more cards in your graveyard, sacrifice this artifact, it deals 2 damage to each opponent, and you gain 2 life." };
  const m = compile(eye);
  assert.equal(m.triggers.length, 0);
});

test("Foot Elite's attack trigger pumps another attacker", () => {
  const fe = { name: "Foot Elite", cmc: 3, type_line: "Creature — Human Ninja", power: "2", oracle_text: "Whenever this creature attacks, another target creature you control gets +1/+0 and gains indestructible until end of turn." };
  assert.equal(compile(fe).triggers[0].eff.tempPump, 1);
});
