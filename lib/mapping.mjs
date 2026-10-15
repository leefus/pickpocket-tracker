/**
 * Translation between app objects and rows in the two Notion databases:
 * "Pickpocket Match Log" and "Pickpocket Decks". Pure, so it runs under
 * `node --test`.
 *
 * Column names live here and only here. Rename a column in Notion, change it
 * here.
 */
import { checkDeck } from "./decklist.mjs";
import { deckVertices, parseEdges } from "./graph.mjs";
import { ARCHETYPES, COLORS, EVENTS, FORMATS, NOT_IN_META, STATUSES } from "./meta.mjs";

export const MATCH = {
  title: "Match",
  date: "Date",
  deck: "Deck",
  opponent: "Opponent",
  opponentName: "Opponent Name",
  opponentArchetype: "Opponent Archetype",
  opponentColors: "Opponent Colors",
  playDraw: "Play/Draw",
  gamesWon: "Games Won",
  gamesLost: "Games Lost",
  event: "Event",
  deadCard: "Dead Card",
  notes: "Notes",
};

export const DECK = {
  name: "Name",
  status: "Status",
  format: "Format",
  archetype: "Archetype",
  colors: "Colors",
  main: "Main Deck",
  side: "Sideboard",
  guide: "Sideboard Guide",
  edges: "Synergy Edges",
  gateMatches: "Gate Matches",
  gateRate: "Gate Win Rate",
  notes: "Notes",
  review: "Claude Review",
  reviewedAt: "Reviewed At",
  reviewedMatches: "Reviewed Matches",
};

// Text written through some Notion tools comes back with markdown escapes ("\\|", "\\{"); undo them.
const unescape = (s) => s.replace(/\\([|{}\[\]*_~`#>\\])/g, "$1");
const plain = (rich) => unescape((rich ?? []).map((t) => t.plain_text ?? t.text?.content ?? "").join("")).trim();
const sel = (p) => p?.select?.name ?? null;
const multi = (p) => (p?.multi_select ?? []).map((o) => o.name);

// Notion caps one rich-text run at 2000 characters; long lists span several runs.
export const richText = (s) => {
  const text = String(s ?? "").trim();
  const runs = [];
  for (let i = 0; i < text.length; i += 2000) runs.push({ type: "text", text: { content: text.slice(i, i + 2000) } });
  return runs;
};

/* ------------------------------------------------------------------ matches */

/** Notion page → match. Rows typed by hand in Notion may have gaps; default them. */
export function toMatch(page) {
  const p = page.properties ?? {};
  return {
    id: page.id,
    createdTime: page.created_time ?? null,
    deckId: p[MATCH.deck]?.relation?.[0]?.id ?? null,
    date: p[MATCH.date]?.date?.start?.slice(0, 10) ?? page.created_time?.slice(0, 10) ?? null,
    opponent: sel(p[MATCH.opponent]) ?? NOT_IN_META,
    opponentName: plain(p[MATCH.opponentName]?.rich_text) || null,
    opponentArchetype: sel(p[MATCH.opponentArchetype]),
    opponentColors: multi(p[MATCH.opponentColors]),
    playDraw: sel(p[MATCH.playDraw]),
    gamesWon: Number(p[MATCH.gamesWon]?.number ?? 0),
    gamesLost: Number(p[MATCH.gamesLost]?.number ?? 0),
    event: sel(p[MATCH.event]),
    deadCard: plain(p[MATCH.deadCard]?.rich_text) || null,
    notes: plain(p[MATCH.notes]?.rich_text) || null,
  };
}

export function matchTitle(m) {
  if (m.opponent !== NOT_IN_META) return `${m.date} vs ${m.opponent}`;
  const what = [m.opponentName, m.opponentArchetype].filter(Boolean).join(" · ") || "off-meta deck";
  return `${m.date} vs ${what}`;
}

/** Match → Notion properties for pages.create. */
export function toMatchProperties(m) {
  const props = {
    [MATCH.title]: { title: richText(matchTitle(m)) },
    [MATCH.date]: { date: { start: m.date } },
    [MATCH.deck]: { relation: [{ id: m.deckId }] },
    [MATCH.opponent]: { select: { name: m.opponent } },
    [MATCH.playDraw]: { select: { name: m.playDraw } },
    [MATCH.gamesWon]: { number: m.gamesWon },
    [MATCH.gamesLost]: { number: m.gamesLost },
    [MATCH.event]: { select: { name: m.event } },
  };
  if (m.opponentArchetype) props[MATCH.opponentArchetype] = { select: { name: m.opponentArchetype } };
  if (m.opponentColors?.length) props[MATCH.opponentColors] = { multi_select: m.opponentColors.map((name) => ({ name })) };
  if (m.opponentName) props[MATCH.opponentName] = { rich_text: richText(m.opponentName) };
  if (m.deadCard) props[MATCH.deadCard] = { rich_text: richText(m.deadCard) };
  if (m.notes) props[MATCH.notes] = { rich_text: richText(m.notes) };
  return props;
}

/**
 * Validate raw match form input against the current meta list.
 * `get(key)` returns one value; `getAll(key)` returns every value for a key.
 * Returns { match } or { error, field } with a message fit to show on the page.
 */
export function parseMatchInput(get, getAll, meta) {
  const s = (k) => String(get(k) ?? "").trim();
  const date = s("date");
  const deckId = s("deckId");
  const opponent = s("opponent");
  const playDraw = s("playDraw");
  const gamesWon = Number(s("gamesWon"));
  const gamesLost = Number(s("gamesLost"));
  const event = s("event") || EVENTS[0];
  const offMeta = opponent === NOT_IN_META;
  const opponentArchetype = s("opponentArchetype") || null;
  const opponentColors = (getAll("opponentColors") ?? []).map(String).filter((c) => COLORS.includes(c));

  if (!/^[0-9a-f-]{32,36}$/i.test(deckId)) return { error: "Pick which deck you were playing.", field: "deckId" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Pick the date you played.", field: "date" };
  if (!offMeta && !meta.includes(opponent)) return { error: "Pick an opponent from the list.", field: "opponent" };
  if (offMeta && !ARCHETYPES.includes(opponentArchetype)) {
    return { error: "For a deck that isn't in the meta, pick its basic type (Aggro, Midrange, and so on).", field: "opponentArchetype" };
  }
  if (!["Play", "Draw"].includes(playDraw)) return { error: "Say whether you were on the play or the draw.", field: "playDraw" };
  if (![0, 1, 2].includes(gamesWon) || ![0, 1, 2].includes(gamesLost) || gamesWon === gamesLost || Math.max(gamesWon, gamesLost) !== 2) {
    return { error: "A Bo3 match ends 2–0 or 2–1. Check the games won and lost.", field: "gamesWon" };
  }
  if (!EVENTS.includes(event)) return { error: "Pick where you played.", field: "event" };

  return {
    match: {
      deckId,
      date,
      opponent,
      opponentName: offMeta ? s("opponentName") || null : null,
      opponentArchetype: offMeta ? opponentArchetype : null,
      opponentColors: offMeta ? opponentColors : [],
      playDraw,
      gamesWon,
      gamesLost,
      event,
      deadCard: s("deadCard") || null,
      notes: s("notes") || null,
    },
  };
}

/* -------------------------------------------------------------------- decks */

export function toDeck(page) {
  const p = page.properties ?? {};
  const num = (k) => (typeof p[k]?.number === "number" ? p[k].number : null);
  return {
    id: page.id,
    createdTime: page.created_time ?? null,
    name: plain(p[DECK.name]?.title) || "Untitled deck",
    status: sel(p[DECK.status]) ?? "Testing",
    format: sel(p[DECK.format]),
    archetype: sel(p[DECK.archetype]),
    colors: multi(p[DECK.colors]),
    main: plain(p[DECK.main]?.rich_text),
    side: plain(p[DECK.side]?.rich_text),
    guide: plain(p[DECK.guide]?.rich_text),
    edges: plain(p[DECK.edges]?.rich_text),
    gateMatches: num(DECK.gateMatches) ?? 30,
    gateRate: num(DECK.gateRate) ?? 0.45,
    notes: plain(p[DECK.notes]?.rich_text) || null,
    review: plain(p[DECK.review]?.rich_text) || null,
    reviewedAt: p[DECK.reviewedAt]?.date?.start ?? null,
    reviewedMatches: num(DECK.reviewedMatches),
  };
}

export function toDeckProperties(d) {
  const props = {
    [DECK.name]: { title: richText(d.name) },
    [DECK.status]: { select: { name: d.status } },
    [DECK.format]: { select: { name: d.format } },
    [DECK.main]: { rich_text: richText(d.main) },
    [DECK.side]: { rich_text: richText(d.side) },
    [DECK.gateMatches]: { number: d.gateMatches },
    [DECK.gateRate]: { number: d.gateRate },
    [DECK.reviewedMatches]: { number: 0 },
  };
  if (d.archetype) props[DECK.archetype] = { select: { name: d.archetype } };
  if (d.colors?.length) props[DECK.colors] = { multi_select: d.colors.map((name) => ({ name })) };
  if (d.guide) props[DECK.guide] = { rich_text: richText(d.guide) };
  if (d.edges) props[DECK.edges] = { rich_text: richText(d.edges) };
  if (d.notes) props[DECK.notes] = { rich_text: richText(d.notes) };
  return props;
}

/** Validate the "Add a deck" form. Returns { deck } or { error, field }. */
export function parseDeckInput(get, getAll) {
  const s = (k) => String(get(k) ?? "").trim();
  const name = s("name");
  const format = s("format") || FORMATS[0];
  const status = s("status") || STATUSES[0];
  const archetype = s("archetype") || null;
  const colors = (getAll("colors") ?? []).map(String).filter((c) => COLORS.includes(c));
  const main = s("main");
  const side = s("side");
  const gateMatches = Number(s("gateMatches") || 30);
  const gatePct = Number(s("gatePct") || 45);

  if (!name) return { error: "Give the deck a name.", field: "name" };
  if (!FORMATS.includes(format)) return { error: "Pick a format.", field: "format" };
  if (!STATUSES.includes(status)) return { error: "Pick a status.", field: "status" };
  if (archetype && !ARCHETYPES.includes(archetype)) return { error: "Pick an archetype from the list.", field: "archetype" };
  if (!Number.isInteger(gateMatches) || gateMatches < 5 || gateMatches > 500) {
    return { error: "The testing gate should be a whole number of matches between 5 and 500.", field: "gateMatches" };
  }
  if (!(gatePct > 0 && gatePct < 100)) return { error: "The gate win rate should be a percentage between 1 and 99.", field: "gatePct" };

  const checked = checkDeck(main, side);
  if (checked.errors.length) return { error: checked.errors.join(" "), field: "main" };
  const edgeCheck = parseEdges(s("edges"), deckVertices(main).map((v) => v.name));
  if (edgeCheck.problems.length) return { error: `Synergy edges: ${edgeCheck.problems.slice(0, 3).join(" ")}`, field: "edges" };

  return {
    deck: {
      name,
      format,
      status,
      archetype,
      colors,
      main,
      side,
      guide: s("guide") || null,
      edges: s("edges") || null,
      gateMatches,
      gateRate: Math.round(gatePct * 10) / 1000,
      notes: s("notes") || null,
    },
  };
}
