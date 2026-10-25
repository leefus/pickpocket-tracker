/**
 * First-pass synergy edges from card text, so every deck has a graph the
 * moment it's created. Claude's hourly review replaces them with a reviewed,
 * rule-based set (see claude/graph_strategy.md in the project).
 *
 * Model: each card PRODUCES some resources and is a PAYOFF for others. An edge
 * A -- B means A produces something B pays off (or the reverse). Pure, so it
 * runs under `node --test`.
 */
import { parseList } from "./decklist.mjs";
import { indexCards } from "./pretest.mjs";

export const AUTO_HEADER = "# Auto-generated from card text";

const textOf = (card) => [card.oracle_text, ...(card.card_faces ?? []).map((f) => f.oracle_text)].filter(Boolean).join("\n");
export const typeOf = (card) => [card.type_line, ...(card.card_faces ?? []).map((f) => f.type_line)].filter(Boolean).join(" // ");

/**
 * Card text with reminder text removed and the card's own name replaced, so
 * "Smaug" never reads as a creature type and "(…Pirates, Rogues…)" never reads as a payoff.
 */
export function ownText(card) {
  let t = textOf(card).replace(/\([^)]*\)/g, "");
  const names = new Set([card.name, ...card.name.split(" // "), ...(card.card_faces ?? []).map((f) => f.name)]);
  for (const n of names) {
    if (!n) continue;
    const short = n.split(",")[0];
    for (const v of [n, short]) if (v.length > 2) t = t.split(v).join("this");
  }
  return t;
}

/**
 * Resources: [id, label, produces(card, text, type), pays off(card, text, type)].
 * Labels read as "A → B: <label>".
 */
export const RULES = [
  [
    "spells",
    "instants and sorceries feed it",
    (c, t, ty) => /\b(Instant|Sorcery)\b/.test(ty),
    (c, t) =>
      /whenever you cast an instant or sorcery|instant (and|or) sorcery cards? in your graveyard|instant cards, sorcery cards|for each instant and sorcery|cards in your graveyard that are instant/i.test(t),
  ],
  [
    "noncreature",
    "noncreature spells trigger it",
    (c, t, ty) => !/\b(Creature|Land)\b/.test(ty),
    (c, t) => /whenever you cast a noncreature spell/i.test(t),
  ],
  [
    "discard",
    "discards trigger it",
    (c, t) => /\bdiscards? (a|one|two|three|that|\w+) cards?|\bdiscard (a card|your hand|two cards)|each (player|opponent) discards/i.test(t),
    (c, t) => /whenever (a player|an opponent|one or more players|you) discards?/i.test(t),
  ],
  [
    "legend",
    "a legendary creature entering triggers it",
    (c, t, ty) => /\bLegendary\b[^/]*\bCreature\b/.test(ty),
    (c, t) => /whenever (a|another) legendary creature (you control )?enters/i.test(t),
  ],
  [
    "reentry",
    "replays its enters-the-battlefield effect",
    (c, t) =>
      /return (another|target|up to one target|one or two target|that)[^.]*?(you control|you own)[^.]*?to (its owner's|your) hand|exile[^.]*?you control[^.]*?(return|then return)[^.]*?to the battlefield/i.test(t),
    (c, t, ty) =>
      !/\bLand\b/.test(ty) &&
      /(^|\n)When (this|this creature|this artifact|this enchantment|this equipment|this aura) enters|whenever (another|a) (nontoken )?creature( or planeswalker)? you control enters/i.test(t),
  ],
  [
    "landfall",
    "extra land drops trigger landfall",
    (c, t) =>
      /play an additional land|play lands from your graveyard|search your library for (a|up to \w+) (basic )?lands? cards?[^.]*onto the battlefield|put (a|that|up to \w+) lands? cards?[^.]*onto the battlefield|return (target|a) land/i.test(t),
    (c, t) => /landfall|whenever a land (you control )?enters/i.test(t),
  ],
  [
    "fodder",
    "tokens and spare bodies pay its sacrifice",
    (c, t) => /create[^.]*token|when this creature dies/i.test(t),
    (c, t) =>
      /sacrifice another|(,|\bor|:)\s*sacrifice an? (creature|artifact|token|permanent)|you may sacrifice|whenever you sacrifice|you('ve)? sacrificed|whenever (a|another) (creature|artifact|token)s? you control (dies|is put into a graveyard)|(artifact tokens|tokens) you control|tap an untapped (permanent|artifact|creature) you control/i.test(t),
  ],
  [
    "treasure",
    "Treasures power it",
    (c, t) => /create[^.]*Treasure/i.test(t),
    (c, t) => /Treasures you control|sacrifice a Treasure/i.test(t),
  ],
  [
    "evasion",
    "an evasive creature connects for it",
    (c, t, ty) => /\bCreature\b/.test(ty) && /(^|\n)(Flash\n)?(Flying|Menace)\b|can't be blocked/i.test(t),
    (c, t) => /whenever a creature you control deals combat damage to a player|\bninjutsu\b/i.test(t),
  ],
  [
    "flying",
    "a creature with flying triggers it",
    (c, t, ty) => /\bCreature\b/.test(ty) && /(^|\n)(Flash\n)?Flying\b/i.test(t),
    (c, t) => /creature spell with flying|another creature you control with flying|creatures? with flying you control/i.test(t),
  ],
  [
    "drain",
    "making opponents lose life powers it",
    (c, t) => /(each|target) opponents? loses? \d+ life|deals \d+ damage to (each opponent|target opponent)/i.test(t),
    (c, t) => /opponent who lost life|if an opponent lost life|opponents? lost life this turn/i.test(t),
  ],
  [
    "tappers",
    "its creatures pay the tap cost",
    (c, t, ty) => /\bCreature\b/.test(ty),
    (c, t) => /\bcrew \d|\bteamwork\b|tap any number of (untapped )?creatures you control/i.test(t),
  ],
  [
    "recursion",
    "brings it back from the graveyard",
    (c, t) => /return[^.]*creature cards?[^.]*from your graveyard to the battlefield/i.test(t),
    (c, t, ty) => /\bCreature\b/.test(ty) && /when this creature (enters|dies)/i.test(t),
  ],
  [
    "lifegain",
    "lifegain triggers it",
    (c, t) => /\bgain (\d+|x|that much) life|\blifelink\b/i.test(t),
    (c, t) => /whenever you gain life|(if|unless) you gained life|life you('ve)? gained/i.test(t),
  ],
  [
    "counters",
    "+1/+1 counters power it",
    (c, t) => /put (a|an|one|two|three|x|\w+) \+1\/\+1 counters?|enters with[^.]*\+1\/\+1 counters?/i.test(t),
    (c, t) => /with (a|one or more) \+1\/\+1 counters? on (it|them)|whenever (one or more )?\+1\/\+1 counters? (are|is) put|for each \+1\/\+1 counter/i.test(t),
  ],
  [
    "steal",
    "casting their cards triggers it",
    (c, t) => /cast[^.]*(from among cards in (that player's|an opponent's) graveyard|the exiled (nonland )?card)|play the exiled card/i.test(t),
    (c, t) => /whenever you cast a spell you don't own|spells? you don't own/i.test(t),
  ],
  [
    "connect",
    "the boost helps it connect",
    (c, t) => /^(Equipped|Enchanted) creature gets \+\d/im.test(t),
    (c, t, ty) => /\bCreature\b/.test(ty) && /whenever (this|this creature)[^.]*deals combat damage to (a player|an opponent)/i.test(t),
  ],
  [
    "theirgy",
    "fills the opponent's graveyard for it",
    (c, t) => /(each|target) opponents? (discards|mills)|\bmills? (a|one|two|\w+) cards?|any number of target players each (discard|mill)/i.test(t),
    (c, t) => /from an opponent's graveyard|in that player's graveyard|opponent's graveyard[^.]*cast/i.test(t),
  ],
  [
    "seconddraw",
    "its extra draws are your second card that turn",
    (c, t) => /\byou draw (that many|two|three|\w+) cards?|\bdraw (two|three) cards|draw a card for each|\binvestigate\b|create (a|two|\w+) Clue/i.test(t),
    (c, t) => /whenever you draw your second card/i.test(t),
  ],
  [
    "lifeloss",
    "making an opponent lose life triggers it",
    (c, t, ty) => /(each|target) opponents? loses? (\d+|x|that much) life|deals (\d+|x) damage to (each opponent|target opponent|any target)/i.test(t) || (/\bCreature\b/.test(ty) && /\b(Flying|Menace)\b|can't be blocked/.test(t)),
    (c, t) => /whenever an opponent loses life|whenever a player loses life/i.test(t),
  ],
  [
    "selffill",
    "fills your graveyard for it",
    (c, t) => /\bsurveil \d|\bmill (a|one|two|three|\w+) cards?|discard (a card|your hand|two cards)/i.test(t),
    (c, t) => /cards? in your graveyard|from your graveyard/i.test(t),
  ],
];

const STOP_TYPES = new Set(["Legendary", "Creature", "Artifact", "Enchantment", "Kindred", "Basic", "Snow", "Token", "Equipment", "Aura", "Vehicle"]);

/** Creature subtypes in the deck ("Dragon", "Elemental"…), from type lines. */
export function subtypesOf(card) {
  return typeOf(card)
    .split(" // ")
    .filter((t) => /\bCreature\b/.test(t))
    .flatMap((t) => (t.split(" — ")[1] ?? "").split(/\s+/))
    .filter((s) => s && !STOP_TYPES.has(s));
}

/**
 * @param {string} mainText Arena-format main deck
 * @param {object[]} cards Scryfall card objects
 * @returns {{ text: string, edges: {a,b,why:string[]}[] }}
 */
export function autoEdges(mainText, cards) {
  const idx = indexCards(cards);
  const vs = parseList(mainText)
    .cards.map((c) => ({ name: c.name, card: idx.get(c.name.toLowerCase()) }))
    .filter((v) => v.card && !/\bLand\b/.test(typeOf(v.card).split(" // ")[0]));
  const info = vs.map((v) => ({ ...v, t: ownText(v.card), ty: typeOf(v.card), subs: subtypesOf(v.card) }));

  const out = new Map();
  const add = (a, b, why) => {
    if (a === b) return;
    const k = [a, b].sort().join("|");
    if (!out.has(k)) out.set(k, { a, b, why: [] });
    if (!out.get(k).why.includes(why)) out.get(k).why.push(why);
  };

  for (const [, label, produces, pays] of RULES) {
    const P = info.filter((v) => produces(v.card, v.t, v.ty));
    const Q = info.filter((v) => pays(v.card, v.t, v.ty));
    for (const q of Q) for (const p of P) add(p.name, q.name, label);
  }

  // Tribal: a card whose text names a creature type pays off the deck's creatures of that type.
  const types = new Set(info.flatMap((v) => v.subs));
  for (const ty of types) {
    const re = new RegExp(`\\b${ty}s?\\b`);
    const members = info.filter((v) => v.subs.includes(ty));
    for (const q of info) if (re.test(q.t)) for (const m of members) add(m.name, q.name, `${ty} synergy`);
  }

  // Tutors: "search your library for a legendary creature card" → the cards it can find.
  for (const q of info) {
    for (const [, want] of q.t.matchAll(/search your library for (?:a|an|up to \w+) ([a-z ]+?) cards?/gi)) {
      const words = want.toLowerCase().split(/\s+/).filter((w) => w && w !== "basic" && w !== "land");
      if (!words.length || /\bland\b/i.test(want)) continue;
      for (const m of info) if (words.every((w) => m.ty.toLowerCase().includes(w))) add(q.name, m.name, `${q.name} can find it`);
    }
  }

  const edges = [...out.values()];
  const date = new Date().toISOString().slice(0, 10);
  const text = [
    `${AUTO_HEADER} on ${date}. Claude replaces these with a reviewed set.`,
    ...edges.map((e) => `${e.a} -- ${e.b} | auto: ${e.why.join("; ")}`),
  ].join("\n");
  return { text, edges };
}

export const isAutoEdges = (text) => String(text ?? "").trimStart().startsWith(AUTO_HEADER);
