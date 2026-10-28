import test from "node:test";
import assert from "node:assert/strict";
import { boardDeck, guidePlans, parsePlan, planFor } from "./sideplan.mjs";

const GUIDE = `Duel sim, 1,000 paired games each. Read as direction.
Boros Dragons (main 56% -> 69%): +1 Get Lost +2 Your Fate Ends Here +1 Unforgiving Aim +2 Repel Calamity; -3 Hop to It -2 Hare Apparent -1 Season of the Burrow. (Cutting 4 Hare + Season instead tested the same, 69%.) Kill Clarion Conqueror on sight.
Jund Sacrifice (82%): no change; +2 Parting Gust -2 Hare tested even (83%).
Dimir Midrange | 2 Jiang Yanggu, Never Alone, 1 Get Lost | 2 Repel Calamity, 1 Season of the Burrow`;

test("parsePlan: signed counts, names with spaces, stops at sentence end and notes", () => {
  const p = parsePlan("+1 Get Lost +2 Your Fate Ends Here; -3 Hop to It −1 Season of the Burrow. Kill Conqueror (first).");
  assert.deepEqual(p.ins, [{ qty: 1, name: "Get Lost" }, { qty: 2, name: "Your Fate Ends Here" }]);
  assert.deepEqual(p.outs, [{ qty: 3, name: "Hop to It" }, { qty: 1, name: "Season of the Burrow" }]);
});

test("guidePlans: reads prose and pipe lines, skips lines without a plan", () => {
  const plans = guidePlans(GUIDE);
  assert.deepEqual(plans.map((p) => p.label), ["Boros Dragons", "Jund Sacrifice", "Dimir Midrange"]);
  assert.equal(plans[0].ins.length, 4);
  assert.equal(plans[0].outs.at(-1).name, "Season of the Burrow");
  assert.deepEqual(plans[2].ins, [{ qty: 2, name: "Jiang Yanggu, Never Alone" }, { qty: 1, name: "Get Lost" }]);
});

test("planFor: matches an opponent by shared words", () => {
  assert.equal(planFor(GUIDE, "Boros Dragons").label, "Boros Dragons");
  assert.equal(planFor(GUIDE, "Dimir Midrange").label, "Dimir Midrange");
  assert.equal(planFor(GUIDE, "Izzet Spellementals"), null);
});

test("boardDeck: applies a legal plan and refuses a bad one", () => {
  const main = "4 Bear\n3 Hop to It\n53 Forest";
  const side = "2 Get Lost\n1 Aim";
  const ok = boardDeck(main, side, { ins: [{ qty: 2, name: "Get Lost" }, { qty: 1, name: "Aim" }], outs: [{ qty: 3, name: "Hop to It" }] });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.text, "4 Bear\n53 Forest\n2 Get Lost\n1 Aim");
  const bad = boardDeck(main, side, { ins: [{ qty: 3, name: "Get Lost" }], outs: [{ qty: 2, name: "Ogre" }] });
  assert.equal(bad.text, undefined);
  assert.equal(bad.errors.length, 3);
});

test("boardDeck: a unique short name resolves to the full card name", () => {
  const r = boardDeck("4 Hare Apparent\n56 Plains", "2 Jiang Yanggu, Never Alone", { ins: [{ qty: 2, name: "Jiang Yanggu" }], outs: [{ qty: 2, name: "Hare" }] });
  assert.deepEqual(r.errors, []);
  assert.equal(r.text, "2 Hare Apparent\n56 Plains\n2 Jiang Yanggu, Never Alone");
});
