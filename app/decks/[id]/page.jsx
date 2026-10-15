import { notFound } from "next/navigation";
import Tracker from "@/components/Tracker";
import { canWrite, getDecks, getMatches, getMeta, hasNotion, missingSettings } from "@/lib/notion";
import { getCardData } from "@/lib/scryfall";
import { pretest } from "@/lib/pretest.mjs";
import { autoEdges } from "@/lib/autoedges.mjs";
import { pressureTable, profileDeck, selfHarm } from "@/lib/axes.mjs";
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

  // Plan profile, with matchup pressure worked out from every other active deck in the tracker.
  let plan = null;
  if (deck) {
    try {
      const active = decks.filter((d) => d.status !== "Retired" || d.id === deck.id);
      const data = await Promise.all(active.map((d) => getCardData(d.main, d.side)));
      const field = active
        .map((d, i) => ({ name: d.name, id: d.id, profile: data[i].cards.length ? profileDeck(d.main, data[i].cards) : null }))
        .filter((f) => f.profile);
      const mine = field.find((f) => f.id === deck.id);
      if (mine) {
        const pressure = pressureTable(field);
        const others = Object.fromEntries(Object.entries(pressure).filter(([n]) => n !== deck.name));
        plan = {
          profile: mine.profile,
          field: field.map((f) => ({ name: f.name, win: f.profile.win, resources: f.profile.resources })),
          pressure,
          harm: selfHarm(mine.profile, others),
        };
      }
    } catch (err) {
      console.error("plan profile failed", err);
    }
  }

  return (
    <Tracker
      deck={deck}
      decks={decks}
      meta={meta}
      matches={matches}
      report={report}
      plan={plan}
      cardError={cardError}
      isNew={searchParams?.new === "1"}
      writable={canWrite()}
      connected={hasNotion()}
      missing={missingSettings()}
      loadError={loadError}
    />
  );
}
