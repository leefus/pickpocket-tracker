import { notFound } from "next/navigation";
import Tracker from "@/components/Tracker";
import { canWrite, getDecks, getMatches, getMeta, hasNotion, missingSettings } from "@/lib/notion";
import { getCardData } from "@/lib/scryfall";
import { pretest } from "@/lib/pretest.mjs";
import { autoEdges } from "@/lib/autoedges.mjs";
import { FALLBACK_META } from "@/lib/meta.mjs";

// Matches change every time you log one; always read fresh from Notion.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }) {
  try {
    const deck = (await getDecks()).find((d) => d.id === params.id);
    return { title: deck ? `${deck.name} · Match Log` : "Deck · Match Log" };
  } catch {
    return { title: "Deck · Match Log" };
  }
}

export default async function DeckPage({ params, searchParams }) {
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

  let deck = decks.find((d) => d.id === params.id) ?? null;
  if (!deck && !loadError && hasNotion()) notFound();

  let report = null;
  let cardError = null;
  if (deck) {
    const [m, cards] = await Promise.all([
      getMatches(deck.id).catch((err) => {
        console.error("getMatches failed", err);
        loadError = "Couldn't load matches from Notion. Check that the integration is connected to the match log.";
        return [];
      }),
      getCardData(deck.main, deck.side),
    ]);
    matches = m;
    cardError = cards.error ?? null;
    if (cards.cards.length) report = pretest({ main: deck.main, side: deck.side, guide: deck.guide, cards: cards.cards });
    // A deck typed straight into Notion (or added before this existed) still gets a graph.
    // Shown only; nothing is written on a page view.
    if (!deck.edges && cards.cards.length) deck = { ...deck, edges: autoEdges(deck.main, cards.cards).text };
  }

  return (
    <Tracker
      deck={deck}
      decks={decks}
      meta={meta}
      matches={matches}
      report={report}
      cardError={cardError}
      isNew={searchParams?.new === "1"}
      writable={canWrite()}
      connected={hasNotion()}
      missing={missingSettings()}
      loadError={loadError}
    />
  );
}
