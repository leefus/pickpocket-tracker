/**
 * Card verdicts: how much each card does on its own vs. through its partners. Pure; runs under node --test.
 *
 *   Own value     the in-silico knockout: replace every copy with a vanilla creature of the same mana value
 *                 (power = toughness = mana value, 1–5) and replay the same duel-sim games. The drop in win
 *                 rate, in points, is what the card adds over a plain body.
 *   Partner value betweenness centrality in the reviewed synergy graph (Brandes), scaled 0–1: how much of
 *                 the deck's synergy routes through the card. Degree is shown alongside.
 *
 * The verdict comes from the pair, because the sim can't see most synergy:
 *   Strong alone   own value clearly above zero: keep it whatever the graph says.
 *   Key in worst matchup  little on average, but clearly positive against the deck's worst matchup (minimax:
 *                 the average hides a card that only matters where you're weakest).
 *   Engine         high partner value, little own value: it matters only next to its partners. The sim can't
 *                  judge it; real games can (track your win rate when it stays on the battlefield).
 *   Role player    some of both.
 *   Sim can't judge little own value and few partners, but the sim reads too little of its text to say.
 *   Cut candidate  little own value and few partners, and the sim reads it: the first card to question.
 */
import { parseList } from "./decklist.mjs";

/** Betweenness centrality for an undirected, unweighted graph (Brandes 2001), normalised to 0–1. */
export function betweenness(names, edges) {
  const adj = new Map(names.map((n) => [n, []]));
  for (const { a, b } of edges) {
    if (!adj.has(a) || !adj.has(b) || a === b) continue;
    adj.get(a).push(b);
    adj.get(b).push(a);
  }
  const cb = new Map(names.map((n) => [n, 0]));
  for (const s of names) {
    const stack = [];
    const pred = new Map(names.map((n) => [n, []]));
    const sigma = new Map(names.map((n) => [n, 0]));
    const dist = new Map(names.map((n) => [n, -1]));
    sigma.set(s, 1);
    dist.set(s, 0);
    const q = [s];
    while (q.length) {
      const v = q.shift();
      stack.push(v);
      for (const w of adj.get(v)) {
        if (dist.get(w) < 0) { dist.set(w, dist.get(v) + 1); q.push(w); }
        if (dist.get(w) === dist.get(v) + 1) { sigma.set(w, sigma.get(w) + sigma.get(v)); pred.get(w).push(v); }
      }
    }
    const delta = new Map(names.map((n) => [n, 0]));
    while (stack.length) {
      const w = stack.pop();
      for (const v of pred.get(w)) delta.set(v, delta.get(v) + (sigma.get(v) / sigma.get(w)) * (1 + delta.get(w)));
      if (w !== s) cb.set(w, cb.get(w) + delta.get(w));
    }
  }
  const n = names.length;
  const norm = n > 2 ? (n - 1) * (n - 2) : 1; // each pair counted twice above (undirected)
  return new Map([...cb].map(([k, v]) => [k, v / norm]));
}

/** A vanilla creature with the same mana value: the yardstick for "what the card adds over a plain body". */
export function standIn(card) {
  const mv = Math.max(1, Math.min(5, Math.round(card?.cmc ?? 2)));
  return { name: `Plain ${mv}-drop`, cmc: mv, mana_cost: `{${mv}}`, type_line: "Creature — Construct", power: String(mv), toughness: String(mv), oracle_text: "", colors: [] };
}

/** Replace every copy of `name` in a list with the stand-in's name, keeping the count. */
export function knockOut(mainText, name, standInName) {
  return parseList(mainText).cards.map((c) => `${c.qty} ${c.name === name ? standInName : c.name}`).join("\n");
}

/**
 * Pick the verdict. `own` and `ownSe` are in win-rate points (0–100 scale); `partner` is betweenness
 * 0–1; `degree` and `maxDegree` from the synergy graph; `textSeen` is the share of the card's text the sim reads.
 */
export function verdictOf({ own, ownSe = 0, partner = 0, degree = 0, maxDegree = 0, textSeen = 1, worst = null, worstSe = 0, worstName = "" }) {
  const clearOwn = own >= 2 && own >= 2 * ownSe;
  const clearWorst = worst != null && worst >= 2 && worst >= 2 * worstSe;
  const partnerHigh = degree > 0 && (partner >= 0.15 || degree >= Math.max(3, 0.6 * maxDegree));
  const lowOwn = own < 1 || own < ownSe;
  if (clearOwn) return { key: "strong", label: "Strong alone", note: "Earns its slot on its own. Keep it whatever the graph says." };
  if (clearWorst)
    return {
      key: "worst",
      label: "Key in worst matchup",
      note: `Little on average, but it clearly helps against ${worstName || "your worst matchup"}, and by the minimax rule that's the matchup that counts. Keep it, or move it to the sideboard only if that matchup is already safe.`,
    };
  if (partnerHigh && lowOwn)
    return {
      key: "engine",
      label: "Engine",
      note:
        textSeen < 0.8
          ? "Matters through its partners, and the sim can't read most of its text, so it can't judge it. Track your win rate in games where it stays on the battlefield."
          : "Matters through its partners, not on its own. If logged games don't show a lift when it sticks, the synergy may be weaker than it looks.",
    };
  if (lowOwn && degree <= 2 && textSeen < 0.8)
    return { key: "blind", label: "Sim can't judge", note: "Little value in the sim, but the sim reads under 80% of its text. Check what it does in real games before cutting it." };
  if (lowOwn && degree <= 2) return { key: "cut", label: "Cut candidate", note: "Little value alone and few partners. The first card to question." };
  return { key: "role", label: "Role player", note: "Some value alone, some through partners." };
}
