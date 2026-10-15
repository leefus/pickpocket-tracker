"use server";

import { revalidatePath } from "next/cache";
import { APIErrorCode, isNotionClientError } from "@notionhq/client";
import { canWrite, createDeckPage, createMatchPage, getMeta, requestAnalysisPage, trashMatchPage } from "@/lib/notion";
import { parseDeckInput, parseMatchInput } from "@/lib/mapping.mjs";

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
