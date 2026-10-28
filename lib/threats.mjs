/**
 * Meta-threat check: does this deck have cheap answers to the meta's big creatures?
 * The 2026-10 studies found that a deck's worst matchup (usually Boros Dragons) is decided by
 * whether it can kill a 4- or 5-mana 4/4+ flier for 3 mana or less. Pure, so it runs under `node --test`.
 */
import { parseList } from "./decklist.mjs";

const text = (c) => (c?.oracle_text ?? (c?.card_faces ?? []).map((f) => f.oracle_text).join(" // ")) || "";
const typeLine = (c) => c?.type_line ?? (c?.card_faces ?? []).map((f) => f.type_line).join(" // ") ?? "";
const front = (n) => String(n).split(" // ")[0];

/** Can this card (mana value 3 or less) kill a 5/5 flier? Damage spells must deal 5+. */
export function cheapAnswer(c) {
  if (!c || (c.cmc ?? 9) > 3 || /\bLand\b/.test(typeLine(c))) return false;
  const t = text(c).replace(/\n/g, " ");
  const limited = /with (mana value [0-2]|power [0-3] or less|toughness [0-3] or less)|mana value (2|3) or less/i.test(t);
  if (/(destroy|exile) target (creature|nonland permanent|artifact or creature|creature or planeswalker|creature, enchantment|nonland permanent an opponent controls|creature an opponent controls|attacking creature)/i.test(t) && !limited) return true;
  if (/destroy target creature with flying/i.test(t)) return true;
  if (/(power or toughness|power|toughness) 4 or greater/i.test(t)) return true;
  if (/mana value 3 or greater/i.test(t)) return true;
  const m = t.match(/deals (\d+) damage to (target creature|any target|target creature or planeswalker)/i);
  if (m && Number(m[1]) >= 5) return true;
  if (/gets -([5-9])\/-\1/i.test(t)) return true;
  return false;
}

const power = (c) => Number(c?.power ?? c?.card_faces?.[0]?.power);
/** A big threat: a creature with power 4+ that costs 5 or less. */
export function bigThreat(c) {
  if (!c || !/\bCreature\b/.test(typeLine(c).split(" // ")[0])) return false;
  return (c.cmc ?? 9) <= 5 && power(c) >= 4;
}
const flies = (c) => /\bflying\b/i.test(text(c).split(" // ")[0]) || (c?.keywords ?? []).includes("Flying");

/** P(at least one of k copies in the first n cards of a 60-card deck). */
export function pAtLeastOne(k, n, deck = 60) {
  if (k <= 0) return 0;
  let none = 1;
  for (let i = 0; i < n; i++) none *= (deck - k - i) / (deck - i);
  return 1 - Math.max(0, none);
}

/**
 * metaDecks: [{ key, name, main }]; cards: card objects for our 75 AND the meta lists.
 * Returns our answers (main and side), the odds of one by turn 4, and each meta deck's big threats.
 */
export function threatCheck(mainText, sideText, metaDecks, cards) {
  const byName = new Map();
  for (const c of cards) byName.set(front(c.name), c);
  const rows = (t) => parseList(t).cards.map((r) => ({ ...r, card: byName.get(front(r.name)) }));
  const answers = (t) => rows(t).filter((r) => cheapAnswer(r.card)).map(({ qty, name }) => ({ qty, name }));
  const mainA = answers(mainText);
  const sideA = answers(sideText);
  const k = mainA.reduce((s, r) => s + r.qty, 0);
  const kSide = sideA.reduce((s, r) => s + r.qty, 0);
  const odds = (n) => ({ play: pAtLeastOne(n, 10), draw: pAtLeastOne(n, 11) }); // turn 4: 7 + 3 draws on the play, + 4 on the draw
  const decks = metaDecks.map((m) => {
    const threats = rows(m.main)
      .filter((r) => bigThreat(r.card))
      .map((r) => ({ qty: r.qty, name: r.name, mv: r.card.cmc, power: power(r.card), flying: flies(r.card) }))
      .sort((a, b) => b.qty - a.qty || a.mv - b.mv);
    return { key: m.key, name: m.name, threats, count: threats.reduce((s, r) => s + r.qty, 0), fliers: threats.filter((t) => t.flying).reduce((s, r) => s + r.qty, 0) };
  });
  return { main: mainA, side: sideA, count: k, sideCount: kSide, odds: odds(k), boarded: odds(Math.min(k + kSide, 60)), decks };
}
