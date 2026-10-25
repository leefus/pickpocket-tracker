/**
 * The meta decks the duel sim plays against: the fixtures the tests already use (tournament lists
 * from MTGGoldfish, 2026-10), named as in the match log's Opponent options. Card data is bundled.
 */
import decks from "./fixtures-meta-decks.json" with { type: "json" };
import metaCards from "./fixtures-meta-cards.json" with { type: "json" };
import izzetCards from "./fixtures-izzet-cards.json" with { type: "json" };

const IZZET = `4 Burst Lightning\n4 Eddymurk Crab\n2 Get Out\n4 Hearth Elemental\n2 Impractical Joke\n6 Island\n4 Opt\n4 Prismari Charm\n4 Riverpyre Verge\n1 Sear\n4 Sleight of Hand\n1 Spell Pierce\n2 Spell Snare\n4 Spirebluff Canal\n4 Steam Vents\n1 Stormcarved Coast\n4 Sunderflock\n1 Thundering Falls\n4 Traumatic Critique`;

export const META_DECKS = [
  { key: "izzet", name: "Izzet Spellementals", main: IZZET },
  { key: "dimir", name: "Dimir Midrange", main: decks.dimir.main },
  { key: "jund", name: "Jund Sacrifice", main: decks.jund.main },
  { key: "dragons", name: "Boros Dragons", main: decks.dragons.main },
  { key: "landfall", name: "Mono-Green Landfall", main: decks.landfall.main },
];
export const META_CARDS = [...metaCards, ...izzetCards];

import { parseList } from "./decklist.mjs";
const listKey = (main) => parseList(main).cards.map((c) => `${c.qty} ${c.name}`).sort().join("|");
const KEYS = new Set(META_DECKS.map((m) => listKey(m.main)));
const NAMES = new Set(META_DECKS.map((m) => m.name));
/** Is this tracker deck just a copy of a bundled meta deck? */
export const isMetaCopy = (deck) => NAMES.has(deck.name) || KEYS.has(listKey(deck.main ?? ""));
