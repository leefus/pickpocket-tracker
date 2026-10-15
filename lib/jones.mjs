/**
 * The Jeffery Jones Fun Ranking.
 *
 * Jeff's axiom: a game holds a fixed amount of fun, so every point of fun you
 * have is a point your opponent doesn't. This scores how un-fun a deck makes
 * the other side of the table, from card text, in four categories:
 *
 *   disruption       — taking things away: discard, counters, "can't", tapping, stealing
 *   decision fatigue — making them think: flash, "unless they pay", ward, modes, your-turn-and-theirs triggers
 *   annoyance        — making it drag: repeated pings, upkeep triggers, things that won't stay dead, swarms
 *   confusion        — making it weird: using their own cards, transforming cards, unusual keywords, copies
 *
 * Cards that compound each other's misery are linked in a "misery graph".
 * Pure, so it runs under `node --test`.
 */
import { parseList } from "./decklist.mjs";
import { indexCards } from "./pretest.mjs";

export const CATEGORIES = [
  { id: "disruption", label: "Disruption", blurb: "taking things away" },
  { id: "fatigue", label: "Decision fatigue", blurb: "making them think" },
  { id: "annoyance", label: "Overwhelming annoyance", blurb: "making it drag" },
  { id: "confusion", label: "Confusion", blurb: "making it weird" },
];

/** Index tiers, lowest first. */
export const TIERS = [
  [0, "Kitchen-table friendly"],
  [20, "A little salty"],
  [40, "Groan-worthy"],
  [60, "Scoop-inducing"],
  [80, "Jeff has left the table"],
];
export const tierOf = (index) => TIERS.filter(([min]) => index >= min).at(-1)[1];

const textOf = (card) => [card.oracle_text, ...(card.card_faces ?? []).map((f) => f.oracle_text)].filter(Boolean).join("\n").replace(/\([^)]*\)/g, "");
const typeOf = (card) => card.card_faces?.[0]?.type_line ?? card.type_line ?? "";

// [category, points, pattern, why]. Each pattern counts once per card.
const RULES = [
  ["disruption", 2, /(each|target) opponents? discards?|any number of target players each discard/i, "makes them discard"],
  ["disruption", 2, /counter target/i, "counters their spells"],
  ["disruption", 2, /can't cast spells|can't be activated|loses all abilities|can't attack|can't block/i, "shuts things off"],
  ["disruption", 1, /tap (up to (one|two) )?target creatures?|stun counter/i, "taps or stuns their creatures"],
  ["disruption", 3, /return (all|each) (non-?\w+ )?creatures?[^.]*to (their|its) owners?'? hands?|destroy all|exile all|deals \w+ damage to each creature/i, "wipes their board"],
  ["disruption", 1, /destroy (up to one |another )?(other )?target (creature|planeswalker|permanent|nonland permanent|artifact|enchantment)|exile target (creature|nonland permanent|permanent)|each opponent sacrifices|deals \w+ damage to (target creature|any target)|target creature gets -\d/i, "removes their stuff"],
  ["disruption", 3, /destroy target (nonbasic )?land/i, "destroys their lands"],
  ["disruption", 1, /(target player|target opponent|each opponent|any number of target players each|target players each) mills?/i, "mills them"],
  ["disruption", 1, /return target (nonland permanent|creature)[^.]*owner's hand/i, "bounces their stuff"],
  ["disruption", 3, /gain control of/i, "steals their permanents"],
  ["disruption", 2, /cast[^.]*(that player's graveyard|an opponent's graveyard|the exiled (nonland )?card)|play the exiled card|spells? you don't own/i, "plays their cards"],
  ["fatigue", 1, /\bflash\b/i, "can show up on their turn"],
  ["fatigue", 1.5, /unless (its controller|they|that player) pays?|\bward\b/i, "taxes their answers"],
  ["fatigue", 1, /choose one|choose two|\bspree\b/i, "has modes to play around"],
  ["fatigue", 1, /(opponent|that player) (chooses|may)|of their choice/i, "hands them a choice"],
  ["fatigue", 1, /during each opponent's turn|whenever an opponent casts|whenever (a|another) player/i, "acts on their turn"],
  ["fatigue", 0.5, /\bmenace\b/i, "makes blocking a puzzle"],
  ["annoyance", 2, /whenever[^.]*(deals \d+ damage to each opponent|opponents? loses? \d+ life|lose \d+ life)/i, "pings them over and over"],
  ["annoyance", 1, /at the beginning of (your|each) upkeep/i, "triggers every turn"],
  ["annoyance", 1.5, /return[^.]*from your graveyard to the battlefield|when [^.]* dies, return|\bindestructible\b|\bhexproof\b|can't be countered/i, "won't stay dead"],
  ["annoyance", 1, /create (two|three|four|x|\d+)[^.]*tokens|whenever[^.]*create[^.]*token/i, "keeps making tokens"],
  ["annoyance", 1, /whenever[^.]*draws? (a|two) cards?|whenever[^.]*investigate/i, "keeps drawing cards"],
  ["annoyance", 0.5, /you gain \w+ life|\blifelink\b/i, "drags the game out"],
  ["confusion", 2, /cast[^.]*(that player's graveyard|an opponent's graveyard|the exiled (nonland )?card)|play the exiled card|spells? you don't own/i, "uses their own cards against them"],
  ["confusion", 1, /copy (target|that|it)|token that's a copy/i, "copies things"],
  ["confusion", 1, /becomes a|in addition to its other types|loses all abilities|change the target/i, "changes what things are"],
  ["confusion", 1, /you may cast[^.]*from exile|exile[^.]*you may (cast|play)/i, "plays from places they can't see"],
];
const ODD_KEYWORDS = /\b(ninjutsu|warp|craft|harmonize|flashback|station|earthbend|blight|behold|teamwork|mobilize|spree|amass|explore|kicker|affinity|bargain|prototype|disguise|cloak|manifest|offspring|impending|gift|plot|saddle|crew)\b/gi;
const ODD_LAYOUTS = new Set(["transform", "modal_dfc", "adventure", "prototype", "split", "flip", "meld"]);

/** Score one card: points per category and the reasons. */
export function scoreCard(card) {
  const t = textOf(card);
  const out = Object.fromEntries(CATEGORIES.map((c) => [c.id, 0]));
  const why = [];
  for (const [cat, pts, re, reason] of RULES) {
    if (re.test(t)) {
      out[cat] += pts;
      why.push(reason);
    }
  }
  const odd = new Set((t.match(ODD_KEYWORDS) ?? []).map((k) => k.toLowerCase()));
  if (odd.size) {
    out.confusion += Math.min(2, 0.5 * odd.size);
    why.push(`unusual rules (${[...odd].join(", ")})`);
  }
  if (ODD_LAYOUTS.has(card.layout)) {
    out.confusion += 1;
    why.push("has two faces or two halves");
  }
  return { scores: out, why: [...new Set(why)] };
}

/* ------------------------------------------------------------- misery graph */

// Roles a card plays in compounding misery.
const ROLE = {
  strip: (t) => /(each|target) opponents? (discards?|mills?|sacrifices)|any number of target players each (discard|mill)|counter target|destroy (up to one |another )?(other )?target|exile target (creature|nonland permanent|permanent)/i.test(t),
  useTheirs: (t) => /cast[^.]*(that player's graveyard|an opponent's graveyard|the exiled (nonland )?card)|play the exiled card|spells? you don't own|gain control of/i.test(t),
  lock: (t) => /counter target|can't cast spells|can't be activated|loses all abilities|tap (up to (one|two) )?target creatures?|stun counter|can't block|return (all|each) (non-?\w+ )?creatures?/i.test(t),
  punish: (t, ty, card) =>
    /whenever[^.]*(deals \d+ damage to each opponent|opponents? loses? \d+ life|lose \d+ life)|each opponent loses \d+ life/i.test(t) ||
    (/\bCreature\b/.test(ty) && /(^|\n)(Flash\n)?(Flying|Menace)\b|can't be blocked/i.test(t)),
  repeat: (t) => /whenever (a player|an opponent|one or more players|a legendary creature|another creature|a creature)[^.]*(discards?|enters|dies)|at the beginning of (your|each) upkeep/i.test(t),
  multiply: (t) => /return (another|target|up to one target|that)[^.]*(you control|you own)[^.]*to (its owner's|your) hand|return[^.]*from your graveyard to the battlefield|create (two|three|x|\w+)[^.]*creature tokens/i.test(t),
  shield: (t) => /(target|another target|enchanted|equipped) creature[^.]*(gains? hexproof|has[^.]*ward|gains? indestructible)|enchanted creature gets[^.]*ward/i.test(t),
  feedOnLoss: (t) => /whenever (an opponent|a player|one or more players) (discards?|loses life|sacrifices|mills)/i.test(t),
};

const MISERY = [
  ["strip", "useTheirs", "M1 your own cards against you: one takes their card away, the other plays it"],
  ["lock", "punish", "M2 nothing you can do: one stops their answer, the other keeps hitting"],
  ["multiply", "repeat", "M3 again and again: one makes the trigger happen twice"],
  ["shield", "punish", "M4 can't answer it: one protects the thing that keeps hurting them"],
  ["shield", "useTheirs", "M4 can't answer it: one protects the thing stealing their cards"],
  ["strip", "feedOnLoss", "M5 salt in the wound: every loss they take triggers more damage"],
];

/**
 * Deck ranking.
 * @returns {{ index, tier, totals, cards, edges, edgesText }}
 */
export function jonesDeck(mainText, cardData) {
  const idx = indexCards(cardData);
  const rows = parseList(mainText)
    .cards.map((c) => ({ ...c, card: idx.get(c.name.toLowerCase()) }))
    .filter((r) => r.card && !/\bLand\b/.test(typeOf(r.card)));
  const cards = rows.map((r) => {
    const { scores, why } = scoreCard(r.card);
    const t = textOf(r.card);
    const ty = typeOf(r.card);
    const roles = Object.entries(ROLE).filter(([, f]) => f(t, ty, r.card)).map(([k]) => k);
    const total = Object.values(scores).reduce((s, v) => s + v, 0);
    return { name: r.name, qty: r.qty, scores, total, why, roles };
  });

  const totals = Object.fromEntries(CATEGORIES.map((c) => [c.id, 0]));
  for (const c of cards) for (const k of Object.keys(totals)) totals[k] += c.qty * c.scores[k];

  const out = new Map();
  for (const [from, to, why] of MISERY) {
    for (const a of cards.filter((c) => c.roles.includes(from))) {
      for (const b of cards.filter((c) => c.roles.includes(to))) {
        if (a.name === b.name) continue;
        const k = [a.name, b.name].sort().join("|");
        if (!out.has(k)) out.set(k, { a: a.name, b: b.name, why: [] });
        if (!out.get(k).why.includes(why)) out.get(k).why.push(why);
      }
    }
  }
  const edges = [...out.values()];
  const edgesText = edges.map((e) => `${e.a} -- ${e.b} | ${e.why.join("; ")}`).join("\n");

  const raw = Object.values(totals).reduce((s, v) => s + v, 0);
  // Compounding pairs add misery, but pairs multiply (7 discard cards × 5 thieves = 35 pairs),
  // so it grows with the square root of the pair count rather than the count itself.
  const compounding = Math.round(COMPOUND * Math.sqrt(edges.length) * 10) / 10;
  const index = Math.min(100, Math.round((100 * (raw + compounding)) / SCALE));
  return { index, tier: tierOf(index), raw, compounding, totals, cards: [...cards].sort((a, b) => b.total * b.qty - a.total * a.qty), edges, edgesText };
}

/** Compounding weight (× √pairs), and the raw total that maps to an index of 100. Calibrated on the Oct 2026 meta decks. */
export const COMPOUND = 3;
export const SCALE = 160;

/**
 * Rank every deck in the tracker. `entries` = [{ id, name, main, cards }].
 * Returns { [id]: { …jonesDeck, rank, of, maxTotals, edgeCount } }, rank 1 = most un-fun.
 */
export function jonesField(entries) {
  const scored = entries.filter((e) => e.cards?.length).map((e) => ({ id: e.id, name: e.name, j: jonesDeck(e.main, e.cards) }));
  const maxTotals = Object.fromEntries(CATEGORIES.map((c) => [c.id, Math.max(0, ...scored.map((s) => s.j.totals[c.id]))]));
  const order = [...scored].sort((a, b) => b.j.index - a.j.index || b.j.raw - a.j.raw);
  return Object.fromEntries(
    order.map((s, i) => [s.id, { ...s.j, name: s.name, rank: i + 1, of: order.length, maxTotals, edgeCount: s.j.edges.length }]),
  );
}
