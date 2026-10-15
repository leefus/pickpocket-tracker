import test from "node:test";
import assert from "node:assert/strict";
import { summarize, wilson } from "./stats.mjs";
import { parseMatchInput, toMatch, toProperties } from "./mapping.mjs";
import { DEAD_CARD_CHOICES } from "./deck.mjs";

const m = (opponent, playDraw, gw, gl, extra = {}) => ({ opponent, playDraw, gamesWon: gw, gamesLost: gl, ...extra });

test("wilson interval brackets the point estimate and stays in [0,1]", () => {
  const [lo, hi] = wilson(6, 10);
  assert.ok(lo < 0.6 && 0.6 < hi);
  assert.ok(lo > 0.3 && hi < 0.85);
  assert.deepEqual(wilson(0, 0), [0, 0]);
  const [l0] = wilson(0, 5);
  assert.equal(l0, 0);
});

test("summarize counts records, play/draw, dead cards and keeps the top 5", () => {
  const s = summarize([
    m("Dimir Midrange", "Play", 2, 1, { deadCard: "Duress" }),
    m("Dimir Midrange", "Draw", 0, 2, { deadCard: "Duress" }),
    m("Boros Dragons", "Play", 1, 2),
    m("Other", "Draw", 2, 0, { otherDeck: "Rakdos Lizards" }),
  ]);
  assert.equal(s.overall.n, 4);
  assert.equal(s.overall.wins, 2);
  assert.deepEqual(s.games, { won: 5, lost: 5 });
  assert.equal(s.onPlay.wins, 1);
  assert.equal(s.onDraw.wins, 1);
  const names = s.byOpponent.map((o) => o.opp);
  for (const t of ["Izzet Spellementals", "Dimir Midrange", "Jund Sacrifice", "Orzhov Life Gain", "Boros Dragons", "Rakdos Lizards"]) {
    assert.ok(names.includes(t), t);
  }
  assert.equal(names[0], "Dimir Midrange");
  assert.deepEqual(s.deadCards[0], { card: "Duress", count: 2, share: 0.5 });
  assert.equal(s.gate.head, "Keep testing.");
});

test("gate flips at 30 matches around 45%", () => {
  const many = (w, l) => [...Array(w).fill(m("Dimir Midrange", "Play", 2, 0)), ...Array(l).fill(m("Dimir Midrange", "Play", 0, 2))];
  assert.equal(summarize(many(14, 16)).gate.tone, "good"); // 46.7%
  assert.equal(summarize(many(13, 17)).gate.tone, "bad"); // 43.3%
});

test("worst matchups get the 35% floor", () => {
  const rows = [...Array(2).fill(m("Boros Dragons", "Play", 2, 1)), ...Array(3).fill(m("Boros Dragons", "Play", 1, 2))];
  const boros = summarize(rows).byOpponent.find((o) => o.opp === "Boros Dragons");
  assert.equal(boros.status.label, "Close"); // 40% ≥ 35%
});

test("form input: valid match parses, bad scores are rejected", () => {
  const form = { date: "2026-10-15", opponent: "Jund Sacrifice", playDraw: "Draw", gamesWon: "2", gamesLost: "1", event: "Arena Bo3", deadCard: "", notes: "  close one " };
  const ok = parseMatchInput((k) => form[k]);
  assert.equal(ok.error, undefined);
  assert.equal(ok.match.notes, "close one");
  assert.equal(ok.match.deadCard, null);
  for (const [w, l] of [["2", "2"], ["1", "0"], ["3", "0"], ["1", "1"]]) {
    const bad = parseMatchInput((k) => ({ ...form, gamesWon: w, gamesLost: l })[k]);
    assert.equal(bad.field, "gamesWon", `${w}-${l}`);
  }
  assert.equal(parseMatchInput((k) => ({ ...form, opponent: "Nope" })[k]).field, "opponent");
  assert.equal(parseMatchInput((k) => ({ ...form, date: "" })[k]).field, "date");
});

test("Notion round trip: toProperties → page shape → toMatch is lossless", () => {
  const match = { date: "2026-10-15", opponent: "Other", otherDeck: "Rakdos Lizards", playDraw: "Play", gamesWon: 1, gamesLost: 2, event: "Paper", deadCard: "Lich's Relic", notes: "flooded" };
  const props = toProperties(match);
  assert.equal(props.Match.title[0].text.content, "2026-10-15 vs Rakdos Lizards");
  // Simulate what Notion returns for the same row.
  const asResponse = Object.fromEntries(
    Object.entries(props).map(([k, v]) => {
      if (v.title) return [k, { title: v.title.map((t) => ({ plain_text: t.text.content })) }];
      if (v.rich_text) return [k, { rich_text: v.rich_text.map((t) => ({ plain_text: t.text.content })) }];
      return [k, v];
    }),
  );
  const back = toMatch({ id: "abc", created_time: "2026-10-15T14:00:00.000Z", properties: asResponse });
  const { id, createdTime, ...rest } = back;
  assert.deepEqual(rest, match);
});

test("hand-typed Notion rows with gaps still map", () => {
  const back = toMatch({ id: "x", created_time: "2026-10-15T14:00:00.000Z", properties: {} });
  assert.equal(back.date, "2026-10-15");
  assert.equal(back.opponent, "Other");
  assert.equal(back.gamesWon, 0);
});

test("dead card choices include sideboard cards and no lands", () => {
  assert.ok(DEAD_CARD_CHOICES.includes("Get Lost"));
  assert.ok(DEAD_CARD_CHOICES.includes("Ambrosia Whiteheart"));
  assert.ok(!DEAD_CARD_CHOICES.includes("Swamp"));
  assert.equal(new Set(DEAD_CARD_CHOICES).size, DEAD_CARD_CHOICES.length);
});
