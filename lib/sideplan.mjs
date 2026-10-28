/**
 * Sideboard plans: read them out of a guide, check them against the 75, and apply them.
 * Pure, so it runs under `node --test`.
 *
 * Two guide styles are understood:
 *   "Boros Dragons | 2 Get Lost, 1 Unforgiving Aim | 3 Hop to It"           (the form's Opponent | In | Out)
 *   "Boros Dragons (main 56% -> 69%): +1 Get Lost +2 Repel Calamity; -3 Hop to It. Kill Conqueror first."
 */
import { parseList } from "./decklist.mjs";

const MINUS = /[-−–]/;

/** "2 Get Lost, 1 Baylen, the Haymaker" → [{qty, name}]. Items start at a count, so commas inside names are safe. */
function items(s) {
  return String(s ?? "")
    .split(/(?:^|[,;+&]|\band\b)\s*(?=\d+\s*x?\s+\S)/i)
    .map((x) => x.trim().replace(/[.,;]+$/, ""))
    .map((x) => x.match(/^(\d+)\s*x?\s+(.+)$/i))
    .filter(Boolean)
    .map((m) => ({ qty: Number(m[1]), name: m[2].trim() }));
}

/** "+1 Get Lost +2 Repel Calamity; -3 Hop to It. Note…" → { ins, outs }. */
export function parsePlan(text) {
  const t = String(text ?? "");
  const ins = [];
  const outs = [];
  // a token is a sign, a count, then the name up to the next signed count, ';', '. ', '(' or the end
  const re = /(^|[\s;:,])([+]|[-−–])\s*(\d+)\s*x?\s+(.+?)(?=\s*(?:[+]|[-−–])\s*\d+\s*x?\s+\S|;|\.\s|\.$|\s\(|$)/g;
  let m;
  while ((m = re.exec(t))) {
    const row = { qty: Number(m[3]), name: m[4].trim().replace(/[.,]+$/, "") };
    (MINUS.test(m[2]) ? outs : ins).push(row);
  }
  return { ins, outs };
}

/** Every line of a guide that holds a plan: [{ label, ins, outs, line }]. */
export function guidePlans(guide) {
  return String(guide ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      if (line.includes("|")) {
        const [opp, inn = "", out = ""] = line.split("|").map((s) => s.trim());
        return { label: opp, ins: items(inn), outs: items(out), line };
      }
      const colon = line.indexOf(":");
      if (colon < 0) return null;
      const label = line.slice(0, colon).replace(/\(.*?\)/g, "").trim();
      return { label, ...parsePlan(line.slice(colon + 1)), line };
    })
    .filter((p) => p && p.label && (p.ins.length || p.outs.length));
}

const words = (s) => String(s).toLowerCase().match(/[a-z0-9]+/g) ?? [];
const STOP = new Set(["the", "of", "and", "mono", "deck"]);

/** The guide plan for an opponent: the line whose label shares the most words with its name (0 shared → none). */
export function planFor(guide, opponentName) {
  const want = new Set(words(opponentName).filter((w) => !STOP.has(w)));
  let best = null;
  let bestScore = 0;
  for (const p of guidePlans(guide)) {
    const score = words(p.label).filter((w) => want.has(w)).length;
    if (score > bestScore) [best, bestScore] = [p, score];
  }
  return best;
}

/**
 * Apply a plan: bring `ins` from the sideboard and take `outs` out of the main.
 * Returns { text, errors }; text is the boarded main deck (only when there are no errors).
 */
export function boardDeck(mainText, sideText, plan) {
  const main = new Map(parseList(mainText).cards.map((c) => [c.name, c.qty]));
  const side = new Map(parseList(sideText).cards.map((c) => [c.name, c.qty]));
  const errors = [];
  const sum = (rows) => rows.reduce((s, r) => s + r.qty, 0);
  // "Jiang Yanggu" → "Jiang Yanggu, Never Alone" when exactly one card in that zone starts with it
  const resolve = (rows, zone) =>
    rows.map((r) => {
      if (zone.has(r.name)) return r;
      const hits = [...zone.keys()].filter((n) => n.toLowerCase().startsWith(r.name.toLowerCase()));
      return hits.length === 1 ? { ...r, name: hits[0] } : r;
    });
  const ins = resolve(plan?.ins ?? [], side);
  const outs = resolve(plan?.outs ?? [], main);
  if (!ins.length && !outs.length) errors.push("The plan has no cards in or out.");
  const merge = (rows) => {
    const m = new Map();
    for (const r of rows) m.set(r.name, (m.get(r.name) ?? 0) + r.qty);
    return m;
  };
  for (const [name, qty] of merge(ins)) {
    const have = side.get(name) ?? 0;
    if (have < qty) errors.push(have ? `The sideboard has only ${have} ${name}, not ${qty}.` : `${name} isn't in the sideboard.`);
  }
  for (const [name, qty] of merge(outs)) {
    const have = main.get(name) ?? 0;
    if (have < qty) errors.push(have ? `The main deck has only ${have} ${name}, not ${qty}.` : `${name} isn't in the main deck.`);
  }
  if (sum(ins) !== sum(outs)) errors.push(`The plan brings in ${sum(ins)} cards but takes out ${sum(outs)}.`);
  if (errors.length) return { errors };
  for (const r of outs) main.set(r.name, main.get(r.name) - r.qty);
  for (const r of ins) main.set(r.name, (main.get(r.name) ?? 0) + r.qty);
  const text = [...main].filter(([, q]) => q > 0).map(([n, q]) => `${q} ${n}`).join("\n");
  return { text, errors };
}
