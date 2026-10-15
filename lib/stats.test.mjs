import test from "node:test";
import assert from "node:assert/strict";
import { opponentLabel, summarize, wilson, worstFromGuide } from "./stats.mjs";
import { parseDeckInput, parseMatchInput, toDeck, toDeckProperties, toMatch, toMatchProperties } from "./mapping.mjs";
import { checkDeck, deadCardChoices, parseGuide, parseList } from "./decklist.mjs";
import { FALLBACK_META, NOT_IN_META } from "./meta.mjs";

const DECK_ID = "3fa5a230-e585-8160-ab8e-fd327efeca08";
const m = (opponent, playDraw, gw, gl, extra = {}) => ({ opponent, playDraw, gamesWon: gw, gamesLost: gl, opponentColors: [], ...extra });

// Simulate what Notion returns for properties we wrote.
const echo = (props) =>
  Object.fromEntries(
    Object.entries(props).map(([k, v]) => {
      if (v.title) return [k, { title: v.title.map((t) => ({ plain_text: t.text.content })) }];
      if (v.rich_text) return [k, { rich_text: v.rich_text.map((t) => ({ plain_text: t.text.content })) }];
      return [k, v];
    }),
  );

const PICKPOCKET_MAIN = `3 Liliana the Faultless
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
4 Lich's Relic (FRA) 57
3 Requiting Hex
4 Bitter Triumph
4 Godless Shrine
4 Concealed Courtyard
3 Shattered Sanctum
2 Bleachbone Verge
2 Multiversal Passage
5 Swamp
3 Plains`;
const PICKPOCKET_SIDE = "Sideboard\n4 Get Lost\n2 Clarion Conqueror\n2 Tithing Blade\n2 Shoot the Sheriff\n3 Duress\n1 Requiting Hex\n1 Steel Hellkite";

test("wilson interval brackets the estimate and stays in [0,1]", () => {
  const [lo, hi] = wilson(6, 10);
  assert.ok(lo < 0.6 && 0.6 < hi && lo > 0.3 && hi < 0.85);
  assert.deepEqual(wilson(0, 0), [0, 0]);
});

test("Arena lists parse, including set codes, headers and 4x", () => {
  const p = parseList("Deck\n4x Get Lost\n2 Lich's Relic (FRA) 57\n\n1 Get Lost");
  assert.deepEqual(p.cards, [{ qty: 5, name: "Get Lost" }, { qty: 2, name: "Lich's Relic" }]);
  assert.equal(p.count, 7);
  assert.equal(parseList("Lich's Relic").errors.length, 1);
});

test("the real Pickpocket 75 is legal; rule breaks are caught", () => {
  const ok = checkDeck(PICKPOCKET_MAIN, PICKPOCKET_SIDE);
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.main.count, 60);
  assert.equal(ok.side.count, 15);
  // Requiting Hex: 3 main + 1 side = 4 is fine; 5 Swamp is fine (basic).
  const five = checkDeck(PICKPOCKET_MAIN, "2 Requiting Hex");
  assert.ok(five.errors.some((e) => e.startsWith("Requiting Hex appears 5")));
  assert.ok(checkDeck("4 Swamp", "").errors.some((e) => e.includes("at least 60")));
  assert.ok(checkDeck(PICKPOCKET_MAIN, "16 Swamp").errors.some((e) => e.includes("at most 15")));
});

test("dead-card choices skip basics and keep sideboard cards", () => {
  const c = deadCardChoices(PICKPOCKET_MAIN, PICKPOCKET_SIDE);
  assert.ok(c.includes("Get Lost") && c.includes("Ambrosia Whiteheart") && c.includes("Godless Shrine"));
  assert.ok(!c.includes("Swamp") && !c.includes("Plains"));
  assert.equal(new Set(c).size, c.length);
});

test("sideboard guide parses and its first two rows are the worst matchups", () => {
  const g = parseGuide("Boros Dragons | 4 Get Lost | 3 Hex\nJund Sacrifice | 2 Conqueror | 2 Doll\nDimir Midrange | 2 Duress | 2 Hex");
  assert.equal(g.length, 3);
  assert.deepEqual(worstFromGuide(g), ["Boros Dragons", "Jund Sacrifice"]);
});

test("summarize: meta rows always show, off-meta groups by type, worst get 35%", () => {
  const rows = [
    m("Dimir Midrange", "Play", 2, 1, { deadCard: "Duress" }),
    m("Dimir Midrange", "Draw", 0, 2, { deadCard: "Duress" }),
    m(NOT_IN_META, "Draw", 2, 0, { opponentArchetype: "Aggro", opponentName: "Rakdos Lizards", opponentColors: ["Black", "Red"] }),
    m(NOT_IN_META, "Play", 1, 2, { opponentArchetype: "Aggro" }),
    ...Array(2).fill(m("Boros Dragons", "Play", 2, 1)),
    ...Array(3).fill(m("Boros Dragons", "Play", 1, 2)),
  ];
  const s = summarize(rows, { meta: FALLBACK_META, worst: ["Boros Dragons", "Jund Sacrifice"] });
  const groups = s.byOpponent.map((o) => o.group);
  for (const t of FALLBACK_META.slice(0, 5)) assert.ok(groups.includes(t), t);
  const off = s.byOpponent.find((o) => o.group === "Off-meta Aggro");
  assert.equal(off.n, 2);
  assert.ok(off.offMeta);
  assert.equal(s.byOpponent.find((o) => o.group === "Boros Dragons").status.label, "Close"); // 40% ≥ 35%
  assert.deepEqual(s.deadCards[0], { card: "Duress", count: 2, share: 2 / 9 });
  assert.equal(opponentLabel(rows[2]), "Rakdos Lizards (BR Aggro)");
  assert.equal(opponentLabel(rows[3]), "Aggro (off-meta)");
});

test("gate uses the deck's own threshold", () => {
  const many = (w, l) => [...Array(w).fill(m("Dimir Midrange", "Play", 2, 0)), ...Array(l).fill(m("Dimir Midrange", "Play", 0, 2))];
  assert.equal(summarize(many(14, 16), { gateMatches: 30, gateRate: 0.45 }).gate.tone, "good");
  assert.equal(summarize(many(14, 16), { gateMatches: 30, gateRate: 0.5 }).gate.tone, "bad");
  assert.equal(summarize(many(5, 5), { gateMatches: 20 }).gate.head, "Keep testing.");
});

test("match form: meta and off-meta paths validate", () => {
  const base = { deckId: DECK_ID, date: "2026-10-15", opponent: "Jund Sacrifice", playDraw: "Draw", gamesWon: "2", gamesLost: "1", event: "Arena Bo3", deadCard: "", notes: " close " };
  const run = (over, colors = []) => {
    const f = { ...base, ...over };
    return parseMatchInput((k) => f[k], () => colors, FALLBACK_META);
  };
  assert.equal(run({}).match.notes, "close");
  assert.equal(run({}).match.opponentArchetype, null);
  assert.equal(run({ opponent: "Made Up Deck" }).field, "opponent");
  assert.equal(run({ opponent: NOT_IN_META }).field, "opponentArchetype");
  const off = run({ opponent: NOT_IN_META, opponentArchetype: "Ramp", opponentName: "Simic Ramp" }, ["Green", "Blue", "Purple"]);
  assert.deepEqual(off.match.opponentColors, ["Green", "Blue"]);
  assert.equal(off.match.opponentName, "Simic Ramp");
  assert.equal(run({ deckId: "" }).field, "deckId");
  for (const [w, l] of [["2", "2"], ["1", "0"], ["3", "0"]]) assert.equal(run({ gamesWon: w, gamesLost: l }).field, "gamesWon");
});

test("Notion round trip for an off-meta match is lossless", () => {
  const match = {
    deckId: DECK_ID, date: "2026-10-15", opponent: NOT_IN_META, opponentName: "Rakdos Lizards", opponentArchetype: "Aggro",
    opponentColors: ["Black", "Red"], playDraw: "Play", gamesWon: 1, gamesLost: 2, event: "Paper", deadCard: "Lich's Relic", notes: "flooded",
  };
  const props = toMatchProperties(match);
  assert.equal(props.Match.title[0].text.content, "2026-10-15 vs Rakdos Lizards · Aggro");
  const { id, createdTime, ...rest } = toMatch({ id: "abc", created_time: "2026-10-15T14:00:00.000Z", properties: echo(props) });
  assert.deepEqual(rest, match);
});

test("deck form → Notion → deck is lossless and enforces the rules", () => {
  const f = { name: "Orzhov Pickpocket", format: "Standard", status: "Testing", archetype: "Aggro", main: PICKPOCKET_MAIN, side: PICKPOCKET_SIDE, guide: "Boros Dragons | a | b", gateMatches: "30", gatePct: "45", notes: "" };
  const parsed = parseDeckInput((k) => f[k], () => ["White", "Black"]);
  assert.equal(parsed.error, undefined);
  assert.equal(parsed.deck.gateRate, 0.45);
  const back = toDeck({ id: "d1", properties: echo(toDeckProperties(parsed.deck)) });
  assert.equal(back.name, "Orzhov Pickpocket");
  assert.equal(back.main, PICKPOCKET_MAIN);
  assert.deepEqual(back.colors, ["White", "Black"]);
  assert.equal(back.gateMatches, 30);
  assert.equal(back.reviewedMatches, 0);
  assert.equal(parseDeckInput((k) => ({ ...f, main: "4 Swamp" })[k], () => []).field, "main");
  assert.equal(parseDeckInput((k) => ({ ...f, name: "" })[k], () => []).field, "name");
});

test("a 2000+ character list survives the rich-text split", () => {
  const long = Array.from({ length: 120 }, (_, i) => `1 Card Number ${i} With A Long Name`).join("\n");
  const props = toDeckProperties({ name: "x", format: "Standard", status: "Testing", main: long, side: "", gateMatches: 30, gateRate: 0.45 });
  assert.ok(props["Main Deck"].rich_text.length > 1);
  assert.equal(toDeck({ id: "x", properties: echo(props) }).main, long);
});
