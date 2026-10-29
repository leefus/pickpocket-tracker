/**
 * Meta-threat check: does this deck have cheap answers to the meta's big creatures?
 * The 2026-10 studies found that a deck's worst matchup (usually Boros Dragons) is decided by
 * whether it can kill a 4- or 5-mana 4/4+ flier for 3 mana or less. Pure, so it runs under `node --test`.
 */
import { parseList } from "./decklist.mjs";

const text = (c) => (c?.oracle_text ?? (c?.card_faces ?? []).map((f) => f.oracle_text).join(" // ")) || "";
const typeLine = (c) => c?.type_line ?? (c?.card_faces ?? []).map((f) => f.type_line).join(" // ") ?? "";
const front = (n) => String(n).split(" // ")[0];

/**
 * Card text with the parts that don't make a cheap answer removed: activated abilities that cost {3} or
 * more generic mana (Barrels of Blasting Jelly's {5}), effects on your own creatures (Daydream's flicker),
 * and kills that need the creature to have been damaged this turn.
 */
export function answerText(c) {
  return text(c)
    .split("\n")
    .filter((line) => !/^[^:]*\{([3-9]|\d\d)\}[^:]*:/.test(line))
    .join(" ")
    .replace(/target creatures? you control/gi, "your creature")
    .replace(/target creature that was dealt damage this turn/gi, "a damaged creature");
}

/** Can this card (mana value 3 or less) kill a 5/5 flier? Damage spells must deal 5+. */
export function cheapAnswer(c) {
  if (!c || (c.cmc ?? 9) > 3 || /\bLand\b/.test(typeLine(c))) return false;
  const t = answerText(c);
  const limited = /with (mana value [0-2]|power [0-3] or less|toughness [0-3] or less)|mana value (2|3) or less/i.test(t);
  if (/choose target creature an opponent controls\. exile that creature/i.test(t)) return true; // Turncoat Kunoichi
  if (/up to one target creature they control.{0,80}exile [^.]*the chosen creature/i.test(t)) return true; // Cloak and Dagger
  if (/target artifact or creature that player controls[^.]*\.[^.]*become Treasure/i.test(t)) return true; // Kitesail Larcenist
  if (/(destroy|exile) (?:up to one )?target (?:non-?(?!land)\w+ )?(creature|nonland permanent|artifact or creature|creature or planeswalker|creature, enchantment|nonland permanent an opponent controls|creature an opponent controls|attacking creature)/i.test(t) && !limited) return true;
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

/* ------------------------------------------------ answer–threat bipartite graph */

const tough = (c) => Number(c?.toughness ?? c?.card_faces?.[0]?.toughness);
const mvOf = (c) => c?.cmc ?? 0;

/**
 * Which creatures can this answer kill? Returns a predicate on the threat card, or null if the card
 * isn't removal. Reads the common Standard patterns: unconditional destroy/exile, mana value and
 * power/toughness limits, "with flying", damage N (needs toughness ≤ N) and -N/-N.
 */
export function killTest(a) {
  if (!a || /\bLand\b/.test(typeLine(a))) return null;
  const t = answerText(a);
  if (/choose target creature an opponent controls\. exile that creature/i.test(t)) return () => true;
  if (/up to one target creature they control.{0,80}exile [^.]*the chosen creature/i.test(t)) return () => true;
  if (/target artifact or creature that player controls[^.]*\.[^.]*become Treasure/i.test(t)) return () => true;
  const tests = [];
  const target = /(destroy|exile) (?:up to one )?target (?:non-?(?!land)\w+ )?(creature|nonland permanent|artifact or creature|creature or planeswalker|creature, enchantment|nonland permanent an opponent controls|creature an opponent controls|attacking creature)([^.]*)/i.exec(t);
  if (target) {
    const rest = target[3] ?? "";
    let m;
    if ((m = /with mana value (\d+) or less/i.exec(rest))) { const n = +m[1]; tests.push((c) => mvOf(c) <= n); }
    else if ((m = /with mana value (\d+) or greater/i.exec(rest))) { const n = +m[1]; tests.push((c) => mvOf(c) >= n); }
    else if ((m = /with power (\d+) or less/i.exec(rest))) { const n = +m[1]; tests.push((c) => power(c) <= n); }
    else if ((m = /with toughness (\d+) or less/i.exec(rest))) { const n = +m[1]; tests.push((c) => tough(c) <= n); }
    else if (/with (power or toughness|power|toughness) (\d+) or greater/i.test(rest)) { const n = +/(\d+) or greater/i.exec(rest)[1]; tests.push((c) => power(c) >= n || tough(c) >= n); }
    else if (/with flying/i.test(rest)) tests.push(flies);
    else tests.push(() => true);
  }
  if (!target) {
    let m;
    if ((m = /destroy target creature with (power or toughness|power|toughness) (\d+) or greater/i.exec(t))) { const n = +m[2]; tests.push((c) => power(c) >= n || tough(c) >= n); }
    else if (/destroy target creature with flying/i.test(t)) tests.push(flies);
    else if ((m = /(destroy|exile) target (?:creature|nonland permanent)[^.]*mana value (\d+) or greater/i.exec(t))) { const n = +m[2]; tests.push((c) => mvOf(c) >= n); }
  }
  const dmg = /deals (\d+) damage to (target creature|any target|target creature or planeswalker|each of one or two targets)/i.exec(t);
  if (dmg) { const n = +dmg[1]; tests.push((c) => tough(c) <= n); }
  const minus = /gets -(\d+)\/-\1/i.exec(t);
  if (minus) { const n = +minus[1]; tests.push((c) => tough(c) <= n); }
  return tests.length ? (c) => tests.some((f) => f(c)) : null;
}

/** A threat worth planning around: a creature with power 3+ or toughness 4+ (any cost: cost reducers make big ones cheap). */
export function keyThreat(c) {
  if (!c || !/\bCreature\b/.test(typeLine(c).split(" // ")[0])) return false;
  return power(c) >= 3 || tough(c) >= 4;
}

/** Maximum bipartite matching (augmenting paths). left: ids; adj: id → [right ids]. */
export function maxMatching(left, adj) {
  const owner = new Map();
  const tryAug = (u, seen) => {
    for (const v of adj.get(u) ?? []) {
      if (seen.has(v)) continue;
      seen.add(v);
      if (!owner.has(v) || tryAug(owner.get(v), seen)) { owner.set(v, u); return true; }
    }
    return false;
  };
  let size = 0;
  for (const u of left) if (tryAug(u, new Set())) size++;
  const matched = new Set(owner.values());
  return { size, unmatched: left.filter((u) => !matched.has(u)) };
}

/**
 * The answer graph against each meta deck. Answers are our cards (main and side) with mana value ≤ maxMv
 * that can kill something; threats are each meta deck's key creatures. For each deck:
 *   threats[]: copies, answers in the main / sideboard (copies) and which cards answer it;
 *   matching:  can every threat type get its own answer copy from the main (Hall's condition)?
 *   cover:     the fewest sideboard copies that give every unanswered threat at least one answer.
 */
export function answerGraph(mainText, sideText, metaDecks, cards, { maxMv = 3 } = {}) {
  const byName = new Map();
  for (const c of cards) byName.set(front(c.name), c);
  const rows = (t) => parseList(t).cards.map((r) => ({ ...r, card: byName.get(front(r.name)) }));
  const answers = (t) => rows(t).map((r) => ({ ...r, test: mvOf(r.card) <= maxMv ? killTest(r.card) : null })).filter((r) => r.test);
  const mainA = answers(mainText);
  const sideA = answers(sideText);
  const decks = metaDecks.map((m) => {
    const threats = rows(m.main)
      .filter((r) => keyThreat(r.card))
      .map((r) => {
        const by = (list) => list.filter((a) => a.test(r.card));
        const inMain = by(mainA);
        const inSide = by(sideA);
        return {
          name: r.name, qty: r.qty, mv: mvOf(r.card), power: power(r.card), toughness: tough(r.card), flying: flies(r.card),
          main: inMain.reduce((s, a) => s + a.qty, 0), side: inSide.reduce((s, a) => s + a.qty, 0),
          answeredBy: inMain.map((a) => a.name), sideBy: inSide.map((a) => a.name),
        };
      })
      .sort((a, b) => a.main - b.main || b.qty - a.qty);
    // matching: one node per threat type, one per answer copy in the main
    const adj = new Map(threats.map((t) => [t.name, mainA.filter((a) => t.answeredBy.includes(a.name)).flatMap((a) => Array.from({ length: a.qty }, (_, i) => `${a.name}#${i}`))]));
    const matching = maxMatching(threats.map((t) => t.name), adj);
    // cover: smallest set of sideboard cards (all their copies) answering every threat the main can't
    const open = threats.filter((t) => t.main === 0);
    let cover = null;
    if (open.length) {
      const names = sideA.map((a) => a.name);
      let best = null;
      for (let mask = 1; mask < 1 << Math.min(names.length, 12); mask++) {
        const pick = sideA.filter((_, i) => mask & (1 << i));
        if (!open.every((t) => pick.some((a) => t.sideBy.includes(a.name)))) continue;
        const copies = pick.reduce((s, a) => s + a.qty, 0);
        if (!best || pick.length < best.cards.length || (pick.length === best.cards.length && copies < best.copies)) best = { cards: pick.map(({ qty, name }) => ({ qty, name })), copies };
      }
      cover = best ?? { cards: [], copies: 0, impossible: open.filter((t) => !t.side).map((t) => t.name) };
    }
    return { key: m.key, name: m.name, threats, matched: matching.size, unmatched: matching.unmatched, open: open.map((t) => t.name), cover };
  });
  return { answers: mainA.map(({ qty, name }) => ({ qty, name })), sideAnswers: sideA.map(({ qty, name }) => ({ qty, name })), decks };
}
