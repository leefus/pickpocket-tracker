/**
 * The deck being tested, and the field it's tested against.
 * Edit this file when the list changes; the page and the form read from it.
 */

export const OPPONENTS = [
  "Izzet Spellementals",
  "Dimir Midrange",
  "Jund Sacrifice",
  "Orzhov Life Gain",
  "Boros Dragons",
  "Four-Color Control",
  "Mono-Green Landfall",
  "Other",
];

// Top 5 by winner's metagame share (Metagame Mentor, Oct 8 2026).
// These always show in the opponent table, even before a match is logged.
export const TOP5 = OPPONENTS.slice(0, 5);

// The two matchups the sideboard is built around. They get a lower bar
// (35%) before the page flags them, since they start as underdogs.
export const WORST = ["Boros Dragons", "Jund Sacrifice"];

export const EVENTS = ["Arena Bo3", "Paper", "MTGO"];

export const MAIN = [
  {
    heading: "Creatures (21)",
    cards: [
      [3, "Liliana the Faultless"],
      [3, "Tinybones, the Pickpocket"],
      [4, "Rank Rat"],
      [2, "Splitskin Doll"],
      [1, "Black Widow, Super Spy"],
      [2, "Ambrosia Whiteheart"],
      [3, "Tinybones, Pocket Nuisance"],
      [2, "Rescue Girl, First Responder"],
      [2, "Hostile Investigator"],
    ],
  },
  {
    heading: "Other spells (16)",
    cards: [
      [3, "Tinybones Joins Up"],
      [1, "The Seriema"],
      [4, "Lich's Relic"],
      [3, "Requiting Hex"],
      [4, "Bitter Triumph"],
    ],
  },
  {
    heading: "Lands (23)",
    cards: [
      [4, "Godless Shrine"],
      [4, "Concealed Courtyard"],
      [3, "Shattered Sanctum"],
      [2, "Bleachbone Verge"],
      [2, "Multiversal Passage"],
      [5, "Swamp"],
      [3, "Plains"],
    ],
  },
];

export const SIDEBOARD = [
  [4, "Get Lost"],
  [2, "Clarion Conqueror"],
  [2, "Tithing Blade"],
  [2, "Shoot the Sheriff"],
  [3, "Duress"],
  [1, "Requiting Hex"],
  [1, "Steel Hellkite"],
];

export const GUIDE = [
  ["Boros Dragons", "4 Get Lost, 2 Tithing Blade, 2 Shoot the Sheriff", "3 Requiting Hex, 2 Splitskin Doll, 1 The Seriema, 2 Liliana"],
  ["Jund Sacrifice", "2 Clarion Conqueror, 2 Get Lost, 1 Steel Hellkite", "2 Splitskin Doll, 2 Liliana, 1 The Seriema"],
  ["Orzhov Life Gain", "1 Requiting Hex, 2 Shoot the Sheriff, 1 Steel Hellkite", "1 The Seriema, 2 Hostile Investigator, 1 Black Widow"],
  ["Dimir Midrange", "2 Duress, 2 Get Lost", "2 Requiting Hex, 1 Black Widow, 1 Splitskin Doll"],
  ["Izzet Spellementals", "2 Duress, 1 Requiting Hex", "1 The Seriema, 2 Hostile Investigator"],
];

const LAND_NAMES = new Set(MAIN[2].cards.map(([, n]) => n));

// Choices for the "dead card" field: every nonland card in the 75, plus the
// two mana problems that aren't a single card's fault.
export const DEAD_CARD_CHOICES = [
  ...new Set([
    ...MAIN.flatMap((s) => s.cards.map(([, n]) => n)).filter((n) => !LAND_NAMES.has(n)),
    ...SIDEBOARD.map(([, n]) => n),
  ]),
  "Too many lands",
  "Too few lands",
];
