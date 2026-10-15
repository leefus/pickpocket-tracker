import Tracker from "@/components/Tracker";
import { canWrite, getDecks, getMatches, getMeta, hasNotion, missingSettings } from "@/lib/notion";
import { FALLBACK_META } from "@/lib/meta.mjs";

// Matches change every time you log one; always read fresh from Notion.
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }) {
  let decks = [];
  let meta = FALLBACK_META;
  let matches = [];
  let loadError = null;

  try {
    [decks, meta] = await Promise.all([getDecks(), getMeta()]);
  } catch (err) {
    console.error("loading decks failed", err);
    loadError = "Couldn't load decks from Notion. Check the token and that the integration is connected to both databases.";
  }

  const deck = decks.find((d) => d.id === searchParams?.deck) ?? decks[0] ?? null;
  if (deck) {
    try {
      matches = await getMatches(deck.id);
    } catch (err) {
      console.error("getMatches failed", err);
      loadError = "Couldn't load matches from Notion. Check that the integration is connected to the match log.";
    }
  }

  return <Tracker deck={deck} decks={decks} meta={meta} matches={matches} writable={canWrite()} connected={hasNotion()} missing={missingSettings()} loadError={loadError} />;
}
