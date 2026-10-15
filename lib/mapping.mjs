/**
 * Translation between a match and a row in the "Pickpocket Match Log"
 * Notion database. Pure, so it runs under `node --test`.
 *
 * Column names live here and only here. Rename a column in Notion, change it
 * here.
 */
import { EVENTS, OPPONENTS } from "./deck.mjs";

export const COLUMNS = {
  title: "Match",
  date: "Date",
  opponent: "Opponent",
  otherDeck: "Other Deck",
  playDraw: "Play/Draw",
  gamesWon: "Games Won",
  gamesLost: "Games Lost",
  event: "Event",
  deadCard: "Dead Card",
  notes: "Notes",
};

const plain = (rich) => (rich ?? []).map((t) => t.plain_text ?? t.text?.content ?? "").join("").trim();

// Notion caps one rich-text run at 2000 characters.
const richText = (s) => {
  const text = String(s ?? "").trim();
  const runs = [];
  for (let i = 0; i < text.length; i += 2000) runs.push({ type: "text", text: { content: text.slice(i, i + 2000) } });
  return runs;
};

/** Notion page → match. Rows typed by hand in Notion may have gaps; default them. */
export function toMatch(page) {
  const p = page.properties ?? {};
  return {
    id: page.id,
    createdTime: page.created_time ?? null,
    date: p[COLUMNS.date]?.date?.start?.slice(0, 10) ?? page.created_time?.slice(0, 10) ?? null,
    opponent: p[COLUMNS.opponent]?.select?.name ?? "Other",
    otherDeck: plain(p[COLUMNS.otherDeck]?.rich_text) || null,
    playDraw: p[COLUMNS.playDraw]?.select?.name ?? null,
    gamesWon: Number(p[COLUMNS.gamesWon]?.number ?? 0),
    gamesLost: Number(p[COLUMNS.gamesLost]?.number ?? 0),
    event: p[COLUMNS.event]?.select?.name ?? null,
    deadCard: plain(p[COLUMNS.deadCard]?.rich_text) || null,
    notes: plain(p[COLUMNS.notes]?.rich_text) || null,
  };
}

/** Match → Notion properties for pages.create. */
export function toProperties(m) {
  const opp = m.opponent === "Other" ? m.otherDeck || "Other" : m.opponent;
  const props = {
    [COLUMNS.title]: { title: richText(`${m.date} vs ${opp}`) },
    [COLUMNS.date]: { date: { start: m.date } },
    [COLUMNS.opponent]: { select: { name: m.opponent } },
    [COLUMNS.playDraw]: { select: { name: m.playDraw } },
    [COLUMNS.gamesWon]: { number: m.gamesWon },
    [COLUMNS.gamesLost]: { number: m.gamesLost },
    [COLUMNS.event]: { select: { name: m.event } },
  };
  if (m.otherDeck) props[COLUMNS.otherDeck] = { rich_text: richText(m.otherDeck) };
  if (m.deadCard) props[COLUMNS.deadCard] = { rich_text: richText(m.deadCard) };
  if (m.notes) props[COLUMNS.notes] = { rich_text: richText(m.notes) };
  return props;
}

/**
 * Validate raw form input. Returns { match } or { error, field } with a
 * message fit to show on the page.
 */
export function parseMatchInput(get) {
  const s = (k) => String(get(k) ?? "").trim();
  const date = s("date");
  const opponent = s("opponent");
  const otherDeck = s("otherDeck") || null;
  const playDraw = s("playDraw");
  const gamesWon = Number(s("gamesWon"));
  const gamesLost = Number(s("gamesLost"));
  const event = s("event") || EVENTS[0];

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Pick the date you played.", field: "date" };
  if (!OPPONENTS.includes(opponent)) return { error: "Pick an opponent from the list.", field: "opponent" };
  if (!["Play", "Draw"].includes(playDraw)) return { error: "Say whether you were on the play or the draw.", field: "playDraw" };
  if (![0, 1, 2].includes(gamesWon) || ![0, 1, 2].includes(gamesLost) || gamesWon === gamesLost || Math.max(gamesWon, gamesLost) !== 2) {
    return { error: "A Bo3 match ends 2–0 or 2–1. Check the games won and lost.", field: "gamesWon" };
  }
  if (!EVENTS.includes(event)) return { error: "Pick where you played.", field: "event" };

  return {
    match: {
      date,
      opponent,
      otherDeck: opponent === "Other" ? otherDeck : null,
      playDraw,
      gamesWon,
      gamesLost,
      event,
      deadCard: s("deadCard") || null,
      notes: s("notes") || null,
    },
  };
}
