"use server";

import { revalidatePath } from "next/cache";
import { APIErrorCode, isNotionClientError } from "@notionhq/client";
import { canWrite, createMatchPage, trashMatchPage } from "@/lib/notion";
import { parseMatchInput } from "@/lib/mapping.mjs";

const checkPasscode = (given) => {
  if (!canWrite()) return { error: "Saving isn't switched on yet. Add NOTION_TOKEN and TRACKER_PASSCODE in Vercel." };
  if (String(given ?? "") !== process.env.TRACKER_PASSCODE) return { error: "That passcode isn't right.", field: "passcode" };
  return null;
};

const notionError = (err, verb) => {
  console.error(`${verb} failed`, err);
  if (isNotionClientError(err)) {
    if ([APIErrorCode.Unauthorized, APIErrorCode.RestrictedResource, APIErrorCode.ObjectNotFound].includes(err.code)) {
      return {
        error:
          "Notion refused it. Check that the integration is connected to the Pickpocket Match Log database and has Insert and Update content.",
      };
    }
    if (err.code === APIErrorCode.ValidationError) return { error: `Notion didn't accept that match: ${err.message}` };
  }
  return { error: `Couldn't reach Notion, so nothing was ${verb === "add" ? "saved" : "removed"}. Try again in a moment.` };
};

/** Returns { ok: true } or { error, field? }. */
export async function addMatch(formData) {
  const denied = checkPasscode(formData.get("passcode"));
  if (denied) return denied;

  const parsed = parseMatchInput((k) => formData.get(k));
  if (parsed.error) return parsed;

  try {
    await createMatchPage(parsed.match);
  } catch (err) {
    return notionError(err, "add");
  }
  revalidatePath("/");
  return { ok: true };
}

export async function removeMatch(pageId, passcode) {
  const denied = checkPasscode(passcode);
  if (denied) return denied;
  if (!/^[0-9a-f-]{32,36}$/i.test(String(pageId))) return { error: "That match id doesn't look right." };

  try {
    await trashMatchPage(pageId);
  } catch (err) {
    return notionError(err, "remove");
  }
  revalidatePath("/");
  return { ok: true };
}
