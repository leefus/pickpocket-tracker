/**
 * Opponent vocabulary.
 *
 * The meta list itself lives in Notion, as the options of the match log's
 * "Opponent" select, so it can be updated without a deploy. FALLBACK_META is
 * only used when Notion can't be reached.
 */

export const NOT_IN_META = "Not in meta";

export const FALLBACK_META = [
  "Izzet Spellementals",
  "Dimir Midrange",
  "Jund Sacrifice",
  "Orzhov Life Gain",
  "Boros Dragons",
  "Four-Color Control",
  "Mono-Green Landfall",
];

export const ARCHETYPES = ["Aggro", "Midrange", "Control", "Combo", "Ramp", "Tempo"];
export const COLORS = ["White", "Blue", "Black", "Red", "Green", "Colorless"];
export const COLOR_LETTER = { White: "W", Blue: "U", Black: "B", Red: "R", Green: "G", Colorless: "C" };
export const EVENTS = ["Arena Bo3", "Paper", "MTGO"];
export const FORMATS = ["Standard", "Pioneer", "Other"];
export const STATUSES = ["Testing", "Active", "Retired"];

// How many meta decks always show in the opponent table, even at 0 matches.
export const TOP_N = 5;

/** "WB" style shorthand for a color list, in WUBRG order. */
export const colorCode = (colors = []) =>
  COLORS.filter((c) => colors.includes(c))
    .map((c) => COLOR_LETTER[c])
    .join("");
