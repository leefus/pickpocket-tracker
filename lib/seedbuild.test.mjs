import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildFromSeeds, landCount, manaBase, seedInfo, roleCohesion, refineByGoldfish } from "./seedbuild.mjs";
import { parseList } from "./decklist.mjs";

const pool = JSON.parse(fs.readFileSync(new URL("./data/standard-pool.json", import.meta.url))).cards;
const landPool = JSON.parse(fs.readFileSync(new URL("./data/standard-lands.json", import.meta.url))).cards;

test("seed needs: Jund's seeds need fodder, not the roles every creature is a payoff for", () => {
  const i = seedInfo(["Biotech Specialist", "Umbral Collar Zealot"], pool);
  assert.deepEqual(i.needs, ["fodder"]);
  assert.ok(i.other.includes("reentry"));
  assert.deepEqual(i.colors, ["B", "G", "R"]);
});

test("an enabler with no payoff role needs payoffs for what it makes (Delney → trigger doubling)", () => {
  assert.ok(seedInfo(["Delney, Streetwise Lookout"], pool).needs.includes("doubler"));
});

test("unknown seeds are reported", () => {
  assert.deepEqual(seedInfo(["Not A Real Card"], pool).missing, ["Not A Real Card"]);
});

test("a build is exactly 60 cards, keeps the seeds, stays in color, and has its lands", () => {
  const r = buildFromSeeds({ seeds: ["Biotech Specialist", "Umbral Collar Zealot"], pool, landPool });
  const list = parseList(r.main);
  assert.equal(list.count, 60);
  for (const s of ["Biotech Specialist", "Umbral Collar Zealot"]) assert.ok(list.cards.some((c) => c.name === s && c.qty === 4), s);
  const ok = new Set(r.colors);
  for (const c of list.cards) {
    const p = pool.find((x) => x.name.split(" // ")[0] === c.name);
    if (p) assert.ok(p.color_identity.every((x) => ok.has(x)), c.name);
    assert.ok(c.qty <= 4 || ["Swamp", "Mountain", "Forest", "Plains", "Island"].includes(c.name), c.name);
  }
  assert.equal(r.lands.reduce((s, l) => s + l.copies, 0), r.landCount);
  assert.equal(r.nonland.filter((x) => x.interaction).reduce((s, x) => s + x.copies, 0), 4);
});

test("landfall builds play at least 24 lands, including a fetch land", () => {
  const r = buildFromSeeds({ seeds: ["Sazh's Chocobo"], pool, landPool });
  assert.ok(r.landCount >= 24, `${r.landCount}`);
  assert.ok(r.lands.some((l) => /Passage|Tunnel/.test(l.name)), JSON.stringify(r.lands));
});

test("land count rule of thumb and mana base totals", () => {
  assert.equal(landCount(2), 23);
  assert.equal(landCount(1), 21);
  assert.equal(landCount(5), 27);
  const m = manaBase(24, ["W", "B"], { W: 10, B: 20, U: 0, R: 0, G: 0 }, landPool);
  assert.equal(m.reduce((s, l) => s + l.copies, 0), 24);
  assert.ok(m.find((l) => l.name === "Swamp").copies > m.find((l) => l.name === "Plains").copies);
});

test("role cohesion: a sacrifice outlet and its fodder are one piece", () => {
  const c = roleCohesion(["Umbral Collar Zealot", "Greedy Freebooter", "Callous Inspector"], pool);
  assert.equal(c.pieces, 1);
});

test("goldfish refinement never keeps a swap that isn't faster", () => {
  const r = buildFromSeeds({ seeds: ["Sazh's Chocobo"], pool, landPool });
  const ref = refineByGoldfish({ main: r.main, cards: [...pool, ...landPool], pool, keep: ["Sazh's Chocobo"], rounds: 2, games: 300 });
  for (const s of ref.steps.filter((s) => s.kept)) assert.ok(s.delta < -2 * s.se && s.delta < 0, JSON.stringify(s));
  assert.equal(parseList(ref.main).count, 60);
  assert.ok(ref.main.includes("Sazh's Chocobo"));
});
