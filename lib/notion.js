/**
 * notion.js — the only file that talks to Notion.
 *
 * Runs server-side only. NOTION_TOKEN never reaches the browser.
 */
import "server-only";
import { Client } from "@notionhq/client";
import { toMatch, toProperties } from "./mapping.mjs";

const DATA_SOURCE_ID = process.env.NOTION_DATA_SOURCE_ID;
const notion = new Client({ auth: process.env.NOTION_TOKEN });

export const hasNotion = () => Boolean(process.env.NOTION_TOKEN && DATA_SOURCE_ID);
export const canWrite = () => hasNotion() && Boolean(process.env.TRACKER_PASSCODE);

/** Every match, newest first. Returns [] with no credentials so the page still renders. */
export async function getMatches() {
  if (!hasNotion()) return [];
  const pages = [];
  let cursor;
  do {
    const res = await notion.dataSources.query({
      data_source_id: DATA_SOURCE_ID,
      page_size: 100,
      start_cursor: cursor,
      sorts: [
        { property: "Date", direction: "descending" },
        { timestamp: "created_time", direction: "descending" },
      ],
    });
    pages.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return pages.map(toMatch);
}

export function createMatchPage(match) {
  return notion.pages.create({
    parent: { type: "data_source_id", data_source_id: DATA_SOURCE_ID },
    properties: toProperties(match),
  });
}

/** Removing a match moves its row to Notion's trash, so a mistake is recoverable. */
export function trashMatchPage(pageId) {
  return notion.pages.update({ page_id: pageId, in_trash: true });
}
