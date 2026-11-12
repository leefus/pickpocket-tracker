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

/** Cut a parsed card name back to a real card: drop trailing commentary ("Gollum. Save removal…"). */
function cleanName(name, known) {
  let n = String(name).split(/\.\s|\s\(|\)/)[0].trim().replace(/[.,;:]+$/, "");
  if (known?.length) {
    const lower = new Map(known.map((k) => [k.toLowerCase(), k]));
    const w = n.split(/\s+/);
    for (let k = w.length; k >= 1; k--) {
      const hit = lower.get(w.slice(0, k).join(" ").toLowerCase());
      if (hit) return hit;
    }
  }
  return n;
}

/**
 * Every line of a guide as a row: { label, ins, outs, note, noChange, line }. Lines without an opponent label
 * (a header like "Duel sim, 1,000 games…") come back with label "" and the text as the note. Parenthesised
 * asides ("(The old plan, +3 Spell Pierce, tested worse)") are notes, not part of the plan; "no change" lines
 * have no plan. `known` (card names in the 75) trims commentary that runs on after a card name.
 */
export function guideRows(guide, known = []) {
  return String(guide ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const fix = (rows) => rows.map((r) => ({ ...r, name: cleanName(r.name, known) }));
      if (line.includes("|")) {
        const [opp, inn = "", out = ""] = line.split("|").map((s) => s.trim());
        const label = opp.replace(/\(.*?\)/g, "").replace(/\s+,/g, ",").trim();
        const tail = out.match(/^(.*?(?:\d+\s*x?\s+[^.(]+?))(?:(\.\s|\s\().*)?$/);
        const note = [opp.match(/\((.*?)\)/)?.[1], out.slice(tail?.[1]?.length ?? out.length).replace(/^[.\s]+/, "")].filter(Boolean).join(" ");
        return { label, ins: fix(items(inn)), outs: fix(items(out)), note: note.trim(), noChange: false, line };
      }
      const colon = line.indexOf(":");
      const label = colon < 0 ? "" : line.slice(0, colon).replace(/\(.*?\)/g, "").replace(/\s+,/g, ",").trim();
      // a header ("Race sim (…), 2,000 games per plan, …: …") is a note, not an opponent
      if (!label || /\d/.test(label) || label.split(/\s+/).length > 10) return { label: "", ins: [], outs: [], note: line, noChange: false, line };
      const head = line.slice(0, colon).match(/\((.*?)\)/)?.[1] ?? "";
      const body = line.slice(colon + 1).trim();
      const noChange = /^no change\b/i.test(body);
      const plan = noChange ? { ins: [], outs: [] } : parsePlan(body.replace(/\([^)]*\)/g, ""));
      // the note is whatever follows the plan's last card, plus the result in the label's brackets
      const lastSigned = noChange ? -1 : Math.max(body.lastIndexOf("; -"), body.lastIndexOf("; −"));
      let rest = body;
      if (!noChange && (plan.ins.length || plan.outs.length)) {
        const after = body.slice(Math.max(0, lastSigned));
        const m = after.match(/\.\s+(.*)$/);
        rest = m ? m[1] : "";
      }
      if (noChange) rest = rest.replace(/^no change\s*[;.,:]?\s*/i, "");
      return { label, ins: fix(plan.ins), outs: fix(plan.outs), note: [head, rest].filter(Boolean).join(". ").trim(), noChange, line };
    });
}

/** Every line of a guide that holds a plan: [{ label, ins, outs, line }]. */
export function guidePlans(guide, known = []) {
  return guideRows(guide, known).filter((p) => p.label && !p.noChange && (p.ins.length || p.outs.length));
}

const words = (s) => String(s).toLowerCase().match(/[a-z0-9]+/g) ?? [];
const STOP = new Set(["the", "of", "and", "mono", "deck"]);

/** The guide plan for an opponent: the line whose label shares the most words with its name (0 shared → none). */
export function planFor(guide, opponentName, known = []) {
  const want = new Set(words(opponentName).filter((w) => !STOP.has(w)));
  let best = null;
  let bestScore = 0;
  for (const p of guidePlans(guide, known)) {
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
