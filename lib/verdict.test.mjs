import test from "node:test";
import assert from "node:assert/strict";
import { betweenness, knockOut, standIn, verdictOf } from "./verdict.mjs";

test("betweenness: the middle of a path carries every shortest path", () => {
  const b = betweenness(["A", "B", "C"], [{ a: "A", b: "B" }, { a: "B", b: "C" }]);
  assert.equal(b.get("B"), 1);
  assert.equal(b.get("A"), 0);
});

test("betweenness: a star's centre is 1, a triangle has no broker", () => {
  const star = betweenness(["H", "a", "b", "c"], [{ a: "H", b: "a" }, { a: "H", b: "b" }, { a: "H", b: "c" }]);
  assert.equal(star.get("H"), 1);
  const tri = betweenness(["x", "y", "z"], [{ a: "x", b: "y" }, { a: "y", b: "z" }, { a: "x", b: "z" }]);
  assert.equal(tri.get("x"), 0);
});

test("standIn and knockOut: same mana value, vanilla body, same copies", () => {
  assert.equal(standIn({ cmc: 3 }).power, "3");
  assert.equal(standIn({ cmc: 9 }).cmc, 5);
  assert.equal(knockOut("4 Delney\n56 Plains", "Delney", "Plain 3-drop"), "4 Plain 3-drop\n56 Plains");
});

test("verdictOf: the four-way split", () => {
  assert.equal(verdictOf({ own: 4.5, ownSe: 0.7, degree: 6, maxDegree: 8 }).key, "strong");
  assert.equal(verdictOf({ own: -0.5, ownSe: 0.5, partner: 0.3, degree: 8, maxDegree: 8, textSeen: 0.5 }).key, "engine");
  assert.equal(verdictOf({ own: 0.1, ownSe: 0.3, partner: 0, degree: 2, maxDegree: 8, textSeen: 1 }).key, "cut");
  assert.equal(verdictOf({ own: 0.1, ownSe: 0.3, partner: 0, degree: 2, maxDegree: 8, textSeen: 0.5 }).key, "blind");
  assert.equal(verdictOf({ own: 1.6, ownSe: 0.4, partner: 0.09, degree: 6, maxDegree: 8 }).key, "role");
});
