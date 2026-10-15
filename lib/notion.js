/**
 * notion.js — the only file that talks to Notion.
 *
 * Runs server-side only. NOTION_TOKEN never reaches the browser.
 */
import "server-only";
import { Client } from "@notionhq/client";
import { MATCH, toDeck, toDeckProperties, toMatch, toMatchProperties } from "./mapping.mjs";
import { FALLBACK_META, NOT_IN_META } from "./meta.mjs";

// NOTION_DATA_SOURCE_ID is the original name for the match log; keep accepting it.
const MATCHES_ID = process.env.NOTION_MATCHES_DATA_SOURCE_ID || process.env.NOTION_DATA_SOURCE_ID;
const DECKS_ID = process.env.NOTION_DECKS_DATA_SOURCE_ID;
// NOTION_BASE_URL is only for pointing tests at a local mock; leave it unset in Vercel.
const notion = new Client({ auth: process.env.NOTION_TOKEN, ...(process.env.NOTION_BASE_URL ? { baseUrl: process.env.NOTION_BASE_URL } : {}) });

/** Names of required settings that are missing at runtime. Never returns values. */
export const missingSettings = () =>
  [
    ["NOTION_TOKEN", process.env.NOTION_TOKEN],
    ["NOTION_MATCHES_DATA_SOURCE_ID", MATCHES_ID],
    ["NOTION_DECKS_DATA_SOURCE_ID", DECKS_ID],
  ]
    .filter(([, v]) => !String(v ?? "").trim())
    .map(([k]) => k);

export const hasNotion = () => missingSettings().length === 0;

/**
 * Setup check for /api/status: which settings are present and whether each
 * database answers. Reports error codes only, never the token or ids.
 */
export async function connectionReport() {
  const token = String(process.env.NOTION_TOKEN ?? "").trim();
  const report = {
    settings: {
      NOTION_TOKEN: token ? (/^(ntn_|secret_)/.test(token) ? "set" : "set, but doesn't start with ntn_ or secret_") : "missing",
      NOTION_MATCHES_DATA_SOURCE_ID: MATCHES_ID ? "set" : "missing",
      NOTION_DECKS_DATA_SOURCE_ID: DECKS_ID ? "set" : "missing",
      TRACKER_PASSCODE: process.env.TRACKER_PASSCODE ? "set" : "missing (site is read-only)",
    },
    vercelEnv: process.env.VERCEL_ENV ?? "local",
    databases: {},
  };
  if (!hasNotion()) return report;
  for (const [label, id] of [["Pickpocket Match Log", MATCHES_ID], ["Pickpocket Decks", DECKS_ID]]) {
    try {
      await notion.dataSources.retrieve({ data_source_id: id });
      report.databases[label] = "ok";
    } catch (err) {
      const hint = {
        unauthorized: "the token is wrong or was regenerated",
        object_not_found: "the integration isn't connected to this database (••• → Connections), or the id is wrong",
        restricted_resource: "the integration lacks Read content",
      }[err?.code];
      report.databases[label] = `error: ${err?.code ?? "unreachable"}${hint ? ` — ${hint}` : ""}`;
    }
  }
  return report;
}
export const canWrite = () => hasNotion() && Boolean(process.env.TRACKER_PASSCODE);

async function queryAll(args) {
  const pages = [];
  let cursor;
  do {
    const res = await notion.dataSources.query({ ...args, page_size: 100, start_cursor: cursor });
    pages.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return pages;
}

/**
 * The current meta: the options of the match log's Opponent select, in the
 * order they appear in Notion. Reorder or rename them there to change the app.
 */
export async function getMeta() {
  if (!hasNotion()) return FALLBACK_META;
  const ds = await notion.dataSources.retrieve({ data_source_id: MATCHES_ID });
  const options = ds.properties?.[MATCH.opponent]?.select?.options ?? [];
  const names = options.map((o) => o.name).filter((n) => n && n !== NOT_IN_META);
  return names.length ? names : FALLBACK_META;
}

/** Decks, Testing and Active first, then by name. */
export async function getDecks() {
  if (!hasNotion()) return [];
  const pages = await queryAll({ data_source_id: DECKS_ID, sorts: [{ timestamp: "created_time", direction: "ascending" }] });
  const rank = { Testing: 0, Active: 1, Retired: 2 };
  return pages.map(toDeck).sort((a, b) => (rank[a.status] ?? 3) - (rank[b.status] ?? 3) || a.name.localeCompare(b.name));
}

/** One deck's matches, newest first. */
export async function getMatches(deckId) {
  if (!hasNotion() || !deckId) return [];
  const pages = await queryAll({
    data_source_id: MATCHES_ID,
    filter: { property: MATCH.deck, relation: { contains: deckId } },
    sorts: [
      { property: MATCH.date, direction: "descending" },
      { timestamp: "created_time", direction: "descending" },
    ],
  });
  return pages.map(toMatch);
}

export function createMatchPage(match) {
  return notion.pages.create({
    parent: { type: "data_source_id", data_source_id: MATCHES_ID },
    properties: toMatchProperties(match),
  });
}

export function createDeckPage(deck) {
  return notion.pages.create({
    parent: { type: "data_source_id", data_source_id: DECKS_ID },
    properties: toDeckProperties(deck),
  });
}

/** Removing a match moves its row to Notion's trash, so a mistake is recoverable. */
export function trashMatchPage(pageId) {
  return notion.pages.update({ page_id: pageId, in_trash: true });
}
