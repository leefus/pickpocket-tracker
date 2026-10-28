"use server";

import { revalidatePath } from "next/cache";
import { APIErrorCode, isNotionClientError } from "@notionhq/client";
import { canWrite, createDeckPage, createMatchPage, getDecks, getMeta, requestAnalysisPage, trashMatchPage, updateDeckList } from "@/lib/notion";
import { parseDeckInput, parseMatchInput } from "@/lib/mapping.mjs";
import { getCardData } from "@/lib/scryfall";
import { autoEdges, isAutoEdges } from "@/lib/autoedges.mjs";
import { BASIC_LANDS, checkDeck, parseList } from "@/lib/decklist.mjs";
import { runSeedBuild, seedInfo } from "@/lib/seedbuild.mjs";
import landData from "@/lib/data/standard-lands.json";
import { buildDuelDeck, coverage, matchup, pairedWin } from "@/lib/duel.mjs";
import { META_CARDS, META_DECKS } from "@/lib/metadecks.mjs";
import { applySwaps } from "@/lib/roles.mjs";
import { boardDeck, parsePlan, planFor } from "@/lib/sideplan.mjs";
import { threatCheck } from "@/lib/threats.mjs";
import { buildDeck, compareSwaps, killTurns, paired, summary } from "@/lib/goldfish.mjs";
import poolData from "@/lib/data/standard-pool.json";

const checkPasscode = (given) => {
  if (!canWrite()) return { error: "Saving isn't switched on yet. Add the Notion variables and TRACKER_PASSCODE in Vercel." };
  if (String(given ?? "") !== process.env.TRACKER_PASSCODE) return { error: "That passcode isn't right.", field: "passcode" };
  return null;
};

const notionError = (err, what) => {
  console.error(`${what} failed`, err);
  if (isNotionClientError(err)) {
    if ([APIErrorCode.Unauthorized, APIErrorCode.RestrictedResource, APIErrorCode.ObjectNotFound].includes(err.code)) {
      return {
        error:
          "Notion refused it. Check that the integration is connected to both the Pickpocket Match Log and Pickpocket Decks databases and has Insert and Update content.",
      };
    }
    if (err.code === APIErrorCode.ValidationError) return { error: `Notion didn't accept that ${what}: ${err.message}` };
  }
  return { error: `Couldn't reach Notion, so the ${what} wasn't saved. Try again in a moment.` };
};

/** Returns { ok: true } or { error, field? }. */
export async function addMatch(formData) {
  const denied = checkPasscode(formData.get("passcode"));
  if (denied) return denied;

  let meta;
  try {
    meta = await getMeta();
  } catch (err) {
    return notionError(err, "match");
  }
  const parsed = parseMatchInput((k) => formData.get(k), (k) => formData.getAll(k), meta);
  if (parsed.error) return parsed;

  try {
    await createMatchPage(parsed.match);
  } catch (err) {
    return notionError(err, "match");
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function removeMatch(pageId, passcode) {
  const denied = checkPasscode(passcode);
  if (denied) return denied;
  if (!/^[0-9a-f-]{32,36}$/i.test(String(pageId))) return { error: "That match id doesn't look right." };
  try {
    await trashMatchPage(pageId);
  } catch (err) {
    return notionError(err, "removal");
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Returns { id } of the new deck or { error, field? }. */
export async function addDeck(formData) {
  const denied = checkPasscode(formData.get("passcode"));
  if (denied) return denied;
  const parsed = parseDeckInput((k) => formData.get(k), (k) => formData.getAll(k));
  if (parsed.error) return parsed;
  // Every new deck gets a synergy graph straight away: first-pass edges from card text,
  // which Claude's hourly review replaces with a reviewed set.
  if (!parsed.deck.edges) {
    const { cards } = await getCardData(parsed.deck.main, parsed.deck.side);
    if (cards.length) parsed.deck.edges = autoEdges(parsed.deck.main, cards).text;
  }
  try {
    const page = await createDeckPage(parsed.deck);
    revalidatePath("/", "layout");
    return { id: page.id };
  } catch (err) {
    return notionError(err, "deck");
  }
}

/** Flag a deck for Claude's pre-test review. Returns { ok: true } or { error }. */
export async function requestAnalysis(deckId, passcode) {
  const denied = checkPasscode(passcode);
  if (denied) return denied;
  if (!/^[0-9a-f-]{32,36}$/i.test(String(deckId))) return { error: "That deck id doesn't look right." };
  try {
    await requestAnalysisPage(deckId);
  } catch (err) {
    return notionError(err, "request");
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

/* ------------------------------------------------------------------ roles + goldfish */

const ID = /^[0-9a-f-]{32,36}$/i;
const poolByName = new Map(poolData.cards.map((c) => [c.name.split(" // ")[0], c]));

async function simDeck(deckId) {
  if (!ID.test(String(deckId))) return { error: "That deck id doesn't look right." };
  let deck;
  try {
    deck = (await getDecks()).find((d) => d.id === deckId);
  } catch (err) {
    return notionError(err, "lookup");
  }
  if (!deck) return { error: "Couldn't find that deck." };
  const { cards, error } = await getCardData(deck.main, deck.side);
  if (!cards.length) return { error: error ?? "No card data for this deck yet." };
  return { deck, cards };
}

const cleanSwaps = (swaps, deckNames) =>
  (Array.isArray(swaps) ? swaps : [])
    .slice(0, 15)
    .map((x) => ({ out: String(x?.out ?? ""), in: String(x?.in ?? "") }))
    .filter((x) => deckNames.has(x.out) && poolByName.has(x.in) && !deckNames.has(x.in));

/**
 * Goldfish-rank candidates for one role: each candidate takes each member's place in turn
 * (same copies, same shuffles) and keeps its best swap. Read-only, so no passcode.
 */
export async function goldfishRole(deckId, { candidates = [], members = [] } = {}) {
  const d = await simDeck(deckId);
  if (d.error) return d;
  const deckNames = new Set(parseList(d.deck.main).cards.map((c) => c.name));
  const cand = [...new Set(candidates.map(String))].filter((n) => poolByName.has(n) && !deckNames.has(n)).slice(0, 8);
  const mem = [...new Set(members.map(String))].filter((n) => deckNames.has(n)).slice(0, 6);
  if (!cand.length || !mem.length) return { error: "Pick at least one candidate and one card to swap out." };
  const cards = [...d.cards, ...cand.map((n) => poolByName.get(n))];
  return compareSwaps(d.deck.main, cards, { candidates: cand, members: mem, games: 1500 });
}

/** Goldfish the deck with the picked swaps against the deck as it is. */
export async function goldfishPicks(deckId, swaps) {
  const d = await simDeck(deckId);
  if (d.error) return d;
  const deckNames = new Set(parseList(d.deck.main).cards.map((c) => c.name));
  const sw = cleanSwaps(swaps, deckNames);
  if (!sw.length) return { error: "No valid swaps picked." };
  const cards = [...d.cards, ...sw.map((x) => poolByName.get(x.in))];
  const next = applySwaps(d.deck.main, sw);
  const games = 3000;
  const a = killTurns(buildDeck(d.deck.main, cards), { games });
  const b = killTurns(buildDeck(next.text, cards), { games });
  return { before: summary(a), after: summary(b), ...paired(a, b), games, swaps: sw, list: next.text };
}

/** Save the deck with the picked swaps as a NEW Testing deck. The original is never changed. */
export async function saveSwapDeck(deckId, swaps, name, passcode) {
  const denied = checkPasscode(passcode);
  if (denied) return denied;
  const d = await simDeck(deckId);
  if (d.error) return d;
  const deckNames = new Set(parseList(d.deck.main).cards.map((c) => c.name));
  const sw = cleanSwaps(swaps, deckNames);
  if (!sw.length) return { error: "No valid swaps picked." };
  const title = String(name ?? "").trim().slice(0, 100) || `${d.deck.name} (role swaps)`;
  const main = applySwaps(d.deck.main, sw).text;
  const checked = checkDeck(main, d.deck.side);
  if (checked.errors.length) return { error: checked.errors.join(" ") };
  const { cards } = await getCardData(main, d.deck.side);
  const deck = {
    name: title,
    format: d.deck.format ?? "Standard",
    status: "Testing",
    archetype: d.deck.archetype,
    colors: d.deck.colors,
    main,
    side: d.deck.side,
    guide: d.deck.guide || null,
    edges: cards.length ? autoEdges(main, cards).text : null,
    gateMatches: d.deck.gateMatches,
    gateRate: d.deck.gateRate,
    notes: `Made from "${d.deck.name}" in the Roles panel: ${sw.map((x) => `${x.in} for ${x.out}`).join("; ")}.`,
  };
  try {
    const page = await createDeckPage(deck);
    revalidatePath("/", "layout");
    return { id: page.id };
  } catch (err) {
    return notionError(err, "deck");
  }
}

/* ------------------------------------------------------------------ build from seeds */

const landPool = landData.cards;
const allNames = new Set([...poolData.cards, ...landPool].map((c) => c.name.split(" // ")[0]));

/** The seeds' colors and needs, before building. Read-only. */
export async function lookupSeeds(seeds) {
  const names = (Array.isArray(seeds) ? seeds : []).map(String).map((s) => s.trim()).filter(Boolean).slice(0, 10);
  if (!names.length) return { error: "Name at least one seed card." };
  const info = seedInfo(names, poolData.cards);
  if (info.missing.length) return { ...info, error: `Not a Standard nonland card: ${info.missing.join(", ")}. Check the spelling.` };
  return info;
}

/** Run the whole method from the seeds and return the 60 (nothing is saved). Read-only, so no passcode. */
export async function buildSeedDeck({ seeds = [], colors = [], needs = [], removal = 4, twins = 0, refine = true } = {}) {
  const names = seeds.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 10);
  if (!names.length) return { error: "Name at least one seed card." };
  const C = [...new Set(colors.map(String))].filter((c) => "WUBRG".includes(c) && c.length === 1);
  const N = [...new Set(needs.map(String))].filter((n) => /^[a-z0-9]+$/.test(n));
  try {
    return runSeedBuild({
      seeds: names,
      pool: poolData.cards,
      landPool,
      colors: C.length ? C : undefined,
      needs: N,
      removal: [0, 4, 8].includes(Number(removal)) ? Number(removal) : 4,
      twins: Number(twins) ? 1 : 0,
      refine: refine !== false,
    });
  } catch (err) {
    console.error("seed build failed", err);
    return { error: "The build failed. Try fewer seeds or different colors." };
  }
}

/** Save a built list as a new Testing deck. */
export async function saveSeedDeck({ main, name, seeds = [], needs = [], colors = [], passcode }) {
  const denied = checkPasscode(passcode);
  if (denied) return denied;
  const text = String(main ?? "");
  const checked = checkDeck(text, "");
  if (checked.errors.length) return { error: checked.errors.join(" ") };
  const unknown = checked.main.cards.map((c) => c.name).filter((n) => !allNames.has(n) && !BASIC_LANDS.has(n));
  if (unknown.length) return { error: `Not in the Standard pool: ${unknown.slice(0, 3).join(", ")}.` };
  const { cards } = await getCardData(text, "");
  const COLOR = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green" };
  const deck = {
    name: String(name ?? "").trim().slice(0, 100) || `${seeds[0] ?? "Seed"} build`,
    format: "Standard",
    status: "Testing",
    archetype: null,
    colors: colors.map((c) => COLOR[c]).filter(Boolean),
    main: text,
    side: "",
    guide: null,
    edges: cards.length ? autoEdges(text, cards).text : null,
    gateMatches: 30,
    gateRate: 0.45,
    notes: `Built from seeds in the app: ${seeds.join(", ")}. Needs: ${needs.join(", ") || "none"}. No sideboard yet.`,
  };
  try {
    const page = await createDeckPage(deck);
    revalidatePath("/", "layout");
    return { id: page.id };
  } catch (err) {
    return notionError(err, "deck");
  }
}

/* ------------------------------------------------------------------ duel sim */

const listKey = (main) => parseList(main).cards.map((c) => `${c.qty} ${c.name}`).sort().join("|");
const META_KEYS = new Set(META_DECKS.map((m) => listKey(m.main)));
const META_NAMES = new Set(META_DECKS.map((m) => m.name));
/** Other tracker decks still in use, minus copies of the bundled meta decks (same name or same list). */
function trackerOpponents(decks, deckId) {
  return decks.filter((x) => x.id !== deckId && x.status !== "Retired" && x.main && !META_NAMES.has(x.name) && !META_KEYS.has(listKey(x.main))).slice(0, 6);
}

/** Opponents for a deck: the bundled meta decks plus the other tracker decks still in use. */
async function duelSetup(deckId) {
  const d = await simDeck(deckId);
  if (d.error) return d;
  let decks = [];
  try {
    decks = await getDecks();
  } catch {}
  const others = trackerOpponents(decks, deckId);
  const otherCards = await Promise.all(others.map((x) => getCardData(x.main, "")));
  const opponents = [
    ...META_DECKS.map((m) => ({ key: `meta:${m.key}`, name: m.name, kind: "meta", deck: buildDuelDeck(m.main, META_CARDS) })),
    ...others.map((x, i) => ({ key: `deck:${x.id}`, name: x.name, kind: "tracker", deck: buildDuelDeck(x.main, otherCards[i].cards) })).filter((o) => o.deck.length >= 40),
  ];
  return { ...d, opponents };
}

/** Simulated win rate against each opponent (read-only, no passcode). */
export async function simulateMatchups(deckId) {
  const s = await duelSetup(deckId);
  if (s.error) return s;
  const me = buildDuelDeck(s.deck.main, s.cards);
  const games = 300;
  const rows = s.opponents.map((o) => {
    const r = matchup(me, o.deck, { games });
    return { key: o.key, name: o.name, kind: o.kind, win: r.win, se: r.se, onPlay: r.onPlay, onDraw: r.onDraw, avgTurns: r.avgTurns, coverage: coverage(o.deck) };
  });
  return { games, coverage: coverage(me), rows };
}

/** Picked swaps against one opponent, on the same games as the current list. */
export async function duelPicks(deckId, opponentKey, swaps) {
  const s = await duelSetup(deckId);
  if (s.error) return s;
  const o = s.opponents.find((x) => x.key === opponentKey);
  if (!o) return { error: "Pick an opponent." };
  const deckNames = new Set(parseList(s.deck.main).cards.map((c) => c.name));
  const sw = cleanSwaps(swaps, deckNames);
  if (!sw.length) return { error: "No valid swaps picked." };
  const cards = [...s.cards, ...sw.map((x) => poolByName.get(x.in))];
  const games = 800;
  const a = matchup(buildDuelDeck(s.deck.main, cards), o.deck, { games });
  const b = matchup(buildDuelDeck(applySwaps(s.deck.main, sw).text, cards), o.deck, { games });
  return { opponent: o.name, before: a.win, after: b.win, ...pairedWin(a, b), games };
}

/**
 * Test a sideboard plan against one opponent: the main deck and the boarded deck play the same games.
 * `planText` is "+2 Card -2 Other"; when it's empty, the deck's guide line for that opponent is used.
 */
export async function testSideboardPlan(deckId, opponentKey, planText) {
  const s = await duelSetup(deckId);
  if (s.error) return s;
  const o = s.opponents.find((x) => x.key === opponentKey);
  if (!o) return { error: "Pick an opponent." };
  const typed = String(planText ?? "").slice(0, 2000).trim();
  const plan = typed ? parsePlan(typed) : planFor(s.deck.guide, o.name);
  if (!plan) return { error: `The sideboard guide has no line for ${o.name}. Type a plan like "+2 Get Lost -2 Hop to It".` };
  const boarded = boardDeck(s.deck.main, s.deck.side, plan);
  if (boarded.errors.length) return { error: boarded.errors.join(" "), plan: { ins: plan.ins, outs: plan.outs } };
  const games = 600;
  const a = matchup(buildDuelDeck(s.deck.main, s.cards), o.deck, { games });
  const b = matchup(buildDuelDeck(boarded.text, s.cards), o.deck, { games });
  return { opponent: o.name, plan: { ins: plan.ins, outs: plan.outs }, before: a.win, after: b.win, ...pairedWin(a, b), games };
}

/** Cheap answers to the meta's big creatures (read-only). */
export async function metaThreats(deckId) {
  const d = await simDeck(deckId);
  if (d.error) return d;
  return threatCheck(d.deck.main, d.deck.side, META_DECKS, [...d.cards, ...META_CARDS]);
}

/**
 * Put a picked card into THIS deck: it takes the place and copies of `out`. Reviewed synergy edges
 * are kept, minus the ones that named the old card, plus first-pass edges for the new one.
 * Every change is logged in the deck's Notes, so it can be undone by hand too.
 */
export async function swapIntoDeck(deckId, swap, passcode, day) {
  const denied = checkPasscode(passcode);
  if (denied) return denied;
  const d = await simDeck(deckId);
  if (d.error) return d;
  const deckNames = new Set(parseList(d.deck.main).cards.map((c) => c.name));
  const sw = cleanSwaps([swap], deckNames);
  if (!sw.length) return { error: "That swap isn't valid (the new card must be a Standard nonland card not already in the deck)." };
  const { in: inn, out } = sw[0];
  const copies = parseList(d.deck.main).cards.find((c) => c.name === out)?.qty ?? 0;
  const main = applySwaps(d.deck.main, sw).text;
  const checked = checkDeck(main, d.deck.side);
  if (checked.errors.length) return { error: checked.errors.join(" ") };
  const { cards } = await getCardData(main, d.deck.side);
  let edges = d.deck.edges;
  if (cards.length) {
    const auto = autoEdges(main, cards);
    if (!edges || isAutoEdges(edges)) edges = auto.text;
    else {
      const kept = edges.split("\n").filter((l) => !l.split("|")[0].split(/\s+(?:--|!!)\s+/).map((x) => x.trim()).includes(out));
      const fresh = auto.edges.filter((e) => e.a === inn || e.b === inn).map((e) => `${e.a} -- ${e.b} | auto: ${e.why.join("; ")}`);
      edges = [...kept, ...fresh].join("\n");
    }
  }
  const stamp = /^\d{4}-\d{2}-\d{2}$/.test(String(day)) ? day : new Date().toISOString().slice(0, 10); // the player's local date when given
  const notes = [d.deck.notes, `${stamp} Roles panel: ${copies} ${inn} in for ${copies} ${out}.`].filter(Boolean).join("\n");
  try {
    await updateDeckList(deckId, { main, edges, notes });
  } catch (err) {
    return notionError(err, "deck change");
  }
  revalidatePath("/", "layout");
  return { ok: true, in: inn, out, copies };
}
