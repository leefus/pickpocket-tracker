import test from "node:test";
import assert from "node:assert/strict";
import {
  algebraicConnectivity,
  analyzeDeck,
  components,
  cutVertices,
  deckVertices,
  isLand,
  parseEdges,
  pBoth,
  pSeen,
  shortLabels,
  symmetricEigenvalues,
  _internal,
} from "./graph.mjs";

const adjOf = (names, pairs) => _internal.adjacency(names, pairs.map(([a, b]) => ({ a, b })));

test("lands are left out of the vertex set", () => {
  assert.ok(isLand("Godless Shrine") && isLand("Swamp") && isLand("Multiversal Passage"));
  assert.ok(!isLand("Lich's Relic"));
  const v = deckVertices("4 Godless Shrine\n4 Lich's Relic\n20 Swamp\n3 Rank Rat");
  assert.deepEqual(v.map((x) => x.name), ["Lich's Relic", "Rank Rat"]);
});

test("edge parsing: synergy, conflict, case-insensitive names, duplicates, unknowns", () => {
  const names = ["Rank Rat", "Bitter Triumph", "Lich's Relic"];
  const r = parseEdges(
    "rank rat -- Bitter Triumph | discard\nBitter Triumph -- Rank Rat | dup\nRank Rat !! Lich's Relic | why\nRank Rat -- Swamp\nnonsense line\n# comment",
    names,
  );
  assert.equal(r.edges.length, 1);
  assert.equal(r.edges[0].reason, "discard");
  assert.equal(r.conflicts.length, 1);
  assert.equal(r.problems.length, 2);
});

test("components, cut vertices and λ₂ on known graphs", () => {
  // Path a-b-c: b is a cut vertex; λ₂(P3) = 1.
  const p3 = ["a", "b", "c"];
  const ap = adjOf(p3, [["a", "b"], ["b", "c"]]);
  assert.deepEqual(cutVertices(p3, ap), ["b"]);
  assert.ok(Math.abs(algebraicConnectivity(p3, ap) - 1) < 1e-9);
  // Cycle C4: no cut vertex; λ₂(C4) = 2.
  const c4 = ["a", "b", "c", "d"];
  const ac = adjOf(c4, [["a", "b"], ["b", "c"], ["c", "d"], ["d", "a"]]);
  assert.deepEqual(cutVertices(c4, ac), []);
  assert.ok(Math.abs(algebraicConnectivity(c4, ac) - 2) < 1e-9);
  // K4: λ₂ = n = 4.
  const k4 = ["a", "b", "c", "d"];
  const ak = adjOf(k4, [["a", "b"], ["a", "c"], ["a", "d"], ["b", "c"], ["b", "d"], ["c", "d"]]);
  assert.ok(Math.abs(algebraicConnectivity(k4, ak) - 4) < 1e-9);
  // Disconnected: two components, λ₂ = 0.
  const two = ["a", "b", "c", "d"];
  const at = adjOf(two, [["a", "b"], ["c", "d"]]);
  assert.equal(components(two, at).length, 2);
  assert.ok(algebraicConnectivity(two, at) < 1e-9);
});

test("Jacobi eigenvalues match a hand-checked matrix", () => {
  const ev = symmetricEigenvalues([
    [2, 1],
    [1, 2],
  ]);
  assert.ok(Math.abs(ev[0] - 1) < 1e-12 && Math.abs(ev[1] - 3) < 1e-12);
});

test("hypergeometric helpers agree with the project's earlier numbers", () => {
  assert.ok(Math.abs(pSeen(3, 7) - 0.3154) < 1e-4); // Pickpocket in opening 7
  assert.ok(Math.abs(pSeen(14, 8) - 0.898) < 1e-3); // discard source by T2 (old build)
  assert.ok(Math.abs(pBoth(4, 18, 10) - 0.5145) < 1e-3); // engine by T4 (old build)
  assert.ok(Math.abs(pBoth(2, 2, 11) - 0.1057) < 1e-3); // Girl + Doll by T5
});

const MAIN = `3 Liliana the Faultless
3 Tinybones, the Pickpocket
4 Rank Rat
2 Splitskin Doll
1 Black Widow, Super Spy
2 Ambrosia Whiteheart
3 Tinybones, Pocket Nuisance
2 Rescue Girl, First Responder
2 Hostile Investigator
3 Tinybones Joins Up
1 The Seriema
4 Lich's Relic
1 Requiting Hex
2 Sheltered by Ghosts
4 Bitter Triumph
4 Godless Shrine
4 Concealed Courtyard
3 Shattered Sanctum
2 Bleachbone Verge
2 Multiversal Passage
5 Swamp
3 Plains`;

test("a small deck graph: hub, cut vertex, stranded cards, isolated, live edges", () => {
  const edges = [
    "Rank Rat -- Tinybones, Pocket Nuisance | discard",
    "Bitter Triumph -- Tinybones, Pocket Nuisance | discard",
    "Requiting Hex -- Tinybones, the Pickpocket | graveyard",
    "Tinybones, the Pickpocket -- Rank Rat | graveyard",
    "Ambrosia Whiteheart !! Sheltered by Ghosts | bounce",
  ].join("\n");
  const g = analyzeDeck(MAIN, edges, { deadCounts: new Map([["Black Widow, Super Spy", 3]]) });
  assert.equal(g.vertexCount, 15);
  assert.equal(g.edgeCount, 4);
  assert.equal(g.conflicts.length, 1);
  assert.deepEqual(new Set(g.cuts), new Set(["Rank Rat", "Tinybones, Pocket Nuisance", "Tinybones, the Pickpocket"]));
  const pick = g.cards.find((c) => c.name === "Tinybones, the Pickpocket");
  assert.deepEqual(pick.stranded, ["Requiting Hex"]);
  assert.ok(g.isolated.includes("Black Widow, Super Spy"));
  assert.equal(g.cards.find((c) => c.name === "Black Widow, Super Spy").dead, 3);
  assert.equal(g.components.length, 1 + g.isolated.length);
  assert.equal(g.lambda2, 0); // isolated cards ⇒ disconnected
  // Live-edge expectation is the sum of the per-edge pBoth values.
  const expect = pBoth(4, 3, 10) + pBoth(4, 3, 10) + pBoth(1, 3, 10) + pBoth(3, 4, 10);
  assert.ok(Math.abs(g.live[4] - expect) < 1e-12);
});

test("handshake lemma holds: degrees sum to twice the edges", () => {
  const edges = "Rank Rat -- Tinybones, Pocket Nuisance\nRank Rat -- Lich's Relic\nLich's Relic -- Tinybones, Pocket Nuisance";
  const g = analyzeDeck(MAIN, edges);
  assert.equal(g.cards.reduce((s, c) => s + c.degree, 0), 2 * g.edgeCount);
});

test("short labels split shared prefixes", () => {
  const m = shortLabels(["Tinybones, the Pickpocket", "Tinybones, Pocket Nuisance", "Tinybones Joins Up", "Rescue Girl, First Responder"]);
  assert.equal(m.get("Tinybones, the Pickpocket"), "Pickpocket");
  assert.equal(m.get("Tinybones, Pocket Nuisance"), "Pocket Nuisance");
  assert.equal(m.get("Tinybones Joins Up"), "Tinybones Join…");
  assert.equal(m.get("Rescue Girl, First Responder"), "Rescue Girl");
});
