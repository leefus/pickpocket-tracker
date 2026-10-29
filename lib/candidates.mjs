/**
 * Replacement candidates for the swap search: the cheap answers that kill the most meta threats, and the
 * most efficient creatures the duel sim can fully read, all castable in the deck's colors. Pure.
 */
import { parseList } from "./decklist.mjs";
import { castableIn, costColors, isLand } from "./roles.mjs";
import { cheapAnswer, keyThreat, killTest } from "./threats.mjs";
import { buildDuelDeck } from "./duel.mjs";

export function replacementIns(mainText, deckCards, poolCards, metaDecks, metaCards, { answers = 4, bodies = 4 } = {}) {
  const list = parseList(mainText).cards;
  const deckNames = new Set(list.map((c) => c.name));
  const byName = new Map(deckCards.map((c) => [c.name.split(" // ")[0], c]));
  const colors = new Set(list.flatMap((c) => (byName.get(c.name) && !isLand(byName.get(c.name)) ? costColors(byName.get(c.name)) : [])));
  const metaBy = new Map(metaCards.map((c) => [c.name.split(" // ")[0], c]));
  const threats = metaDecks.flatMap((m) => parseList(m.main).cards.map((r) => ({ qty: r.qty, card: metaBy.get(r.name) })).filter((r) => keyThreat(r.card)));
  const pool = poolCards.filter((c) => !isLand(c) && !deckNames.has(c.name) && (c.cmc ?? 9) >= 1 && (c.cmc ?? 9) <= 5 && castableIn(c, colors));
  const A = pool
    .filter((c) => cheapAnswer(c))
    .map((c) => { const k = killTest(c); return { name: c.name, score: threats.reduce((s, t) => s + (k && k(t.card) ? t.qty : 0), 0) - c.cmc }; })
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, answers);
  const B = pool
    .filter((c) => /\bCreature\b/.test(c.type_line ?? ""))
    .map((c) => { const m = buildDuelDeck(`1 ${c.name}`, [c])[0]; return { name: c.name, score: (m?.value ?? 0) - c.cmc, seen: m?.textSeen ?? 0, ok: m && !m.defender && !m.cantBlock && (m.power ?? 0) >= 1 }; })
    .filter((x) => x.seen >= 0.8 && x.ok)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, bodies);
  return [...A, ...B].map((x) => x.name);
}
