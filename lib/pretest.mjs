/**
 * Pre-test report: the math we do in the project before a deck plays its first
 * match, computed from the decklist plus Scryfall card data. Pure, so it runs
 * under `node --test`.
 *
 * Every probability is exact hypergeometric (60-card deck, on the play: by
 * turn t you've seen 6 + t cards). Nothing here mulligans.
 */
import { BASIC_LANDS, parseGuide, parseList } from "./decklist.mjs";

export const COLOR_NAMES = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green" };
const WUBRG = Object.keys(COLOR_NAMES);

/* ---------------------------------------------------------------- counting */

const lnFact = (() => {
  const t = [0];
  for (let i = 1; i <= 400; i++) t[i] = t[i - 1] + Math.log(i);
  return (n) => t[n];
})();
/** C(n, k) as a float; exact enough for decks (well under 1e-12 relative error). */
export const choose = (n, k) => (k < 0 || k > n || n < 0 ? 0 : Math.exp(lnFact(n) - lnFact(k) - lnFact(n - k)));

/** P(at least one of K hits among n cards from N). */
export const pAny = (N, K, n) => (n >= N ? (K > 0 ? 1 : 0) : 1 - choose(N - K, n) / choose(N, n));

/** P(exactly k of K hits among n cards from N). */
export const pExactly = (N, K, n, k) => (choose(K, k) * choose(N - K, n - k)) / choose(N, n);

/** P(at least k of K hits among n cards from N). */
export function pAtLeast(N, K, n, k) {
  let s = 0;
  for (let i = k; i <= Math.min(K, n); i++) s += pExactly(N, K, n, i);
  return Math.min(1, s);
}

/**
 * Karsten-style casting check: among n cards, P(at least `need` sources of a
 * color AND at least `lands` lands) / P(at least `lands` lands). L lands in the
 * deck, C of them make the color. Conditioning on hitting land drops isolates
 * the color problem from the land-count problem.
 */
export function pColorGivenLands(N, L, C, n, need, lands) {
  let num = 0;
  let den = 0;
  for (let c = 0; c <= Math.min(C, n); c++) {
    for (let o = 0; o <= Math.min(L - C, n - c); o++) {
      if (c + o < lands) continue;
      const p = (choose(C, c) * choose(L - C, o) * choose(N - L, n - c - o)) / choose(N, n);
      den += p;
      if (c >= need) num += p;
    }
  }
  return den > 0 ? num / den : 0;
}

/* ---------------------------------------------------------------- card data */

const front = (card) => card?.card_faces?.[0] ?? card;
const isLandCard = (card) => /\bLand\b/.test(front(card)?.type_line ?? card?.type_line ?? "");

/** Index Scryfall cards by full name and front-face name, lower-cased. */
export function indexCards(cards) {
  const m = new Map();
  for (const c of cards ?? []) {
    m.set(c.name.toLowerCase(), c);
    const f = c.card_faces?.[0]?.name;
    if (f) m.set(f.toLowerCase(), c);
    const split = c.name.split(" // ")[0];
    if (split) m.set(split.toLowerCase(), c);
  }
  return m;
}

/** "{1}{W}{W}" → { W: 2, generic: 1 }. Hybrid and Phyrexian pips are left out of color demand. */
export function pips(manaCost) {
  const out = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const [, sym] of String(manaCost ?? "").matchAll(/\{([^}]+)\}/g)) if (sym in out) out[sym] += 1;
  return out;
}

/**
 * How a land enters: untapped; "life" (shock: pay 2 life or tapped);
 * "early" (fast land: untapped on turns 1–3); "late" (slow land: tapped on
 * turns 1–2); tapped.
 */
export function landEntry(oracle) {
  const t = String(oracle ?? "");
  if (/enters tapped unless you control two or fewer other lands/i.test(t)) return "early";
  if (/enters tapped unless you control two or more other lands/i.test(t)) return "late";
  if (/pay 2 life\. If you don't, it enters tapped/i.test(t)) return "life";
  if (/enters (the battlefield )?tapped/i.test(t)) return "tapped";
  return "untapped";
}

/** Colors a land can make, and whether it is "flexible" (one color chosen as it enters). */
export function landColors(card) {
  const oracle = card.oracle_text ?? card.card_faces?.map((f) => f.oracle_text).join("\n") ?? "";
  if (/choose a basic land type|choose a color/i.test(oracle) && !(card.produced_mana ?? []).length) {
    return { colors: [...WUBRG], flex: true };
  }
  const fromType = WUBRG.filter((c) => new RegExp(`\\b${{ W: "Plains", U: "Island", B: "Swamp", R: "Mountain", G: "Forest" }[c]}\\b`).test(card.type_line ?? ""));
  const made = (card.produced_mana ?? []).filter((c) => WUBRG.includes(c));
  return { colors: [...new Set([...made, ...fromType])], flex: false };
}

const INTERACTION =
  /\b(destroy|exile) (up to (one|two|three) )?target\b(?![^.]*\bcard from\b)|\bdeals? (\w+|X) damage to (any target|(up to (one|two) )?targets? (creature|planeswalker|player|opponent|battle))|\b(each|target) opponent sacrifices\b|\bcounter target\b|\bfights? (up to one )?target\b|\breturn target (nonland permanent|creature)[^.]*to its owner's hand/i;
const REDUCER = /\bThis spell costs \{?X?\d*\}? less to cast\b|\bcosts \{\d\} less to cast for each\b/i;
/** Cards that get cheaper during the game (Eddymurk Crab, Hearth Elemental, Sunderflock…): printed mana value overstates their cost. */
export const isCostReducer = (card) => REDUCER.test(card.oracle_text ?? card.card_faces?.map((f) => f.oracle_text).join("\n") ?? "");

export const isInteraction = (card) =>
  !isLandCard(card) && INTERACTION.test(card.oracle_text ?? card.card_faces?.map((f) => f.oracle_text).join("\n") ?? "");

/* ---------------------------------------------------------- sideboard plans */

/** "4 Get Lost, 2 Tinybones, the Pickpocket" → [{qty, name}]; commas inside names are kept. */
export function parseSwapList(text) {
  return [...String(text ?? "").matchAll(/(\d+)\s*x?\s+(.+?)\s*(?=,\s*\d+\s*x?\s|$)/g)].map((m) => ({ qty: Number(m[1]), name: m[2].trim() }));
}

/** Resolve a short name ("Liliana", "Nita") to one card in the pool, or null if unknown or ambiguous. */
export function resolveName(name, pool) {
  const n = name.toLowerCase();
  const exact = pool.find((p) => p.toLowerCase() === n);
  if (exact) return exact;
  const hits = pool.filter((p) => {
    const l = p.toLowerCase();
    return l.startsWith(`${n} `) || l.startsWith(`${n},`) || l.split(",")[0] === n;
  });
  return hits.length === 1 ? hits[0] : null;
}

/** Why a short name didn't resolve: unknown, or which cards it could mean. */
function unresolved(name, pool, where) {
  const n = name.toLowerCase();
  const hits = pool.filter((p) => p.toLowerCase().includes(n));
  return hits.length > 1 ? `"${name}" could be ${hits.join(" or ")}; use the full name` : `"${name}" isn't in the ${where}`;
}

/** Check each guide row: swaps balance, the cards exist, and nothing goes over 4. */
export function checkPlans(guideText, mainText, sideText) {
  const main = new Map(parseList(mainText).cards.map((c) => [c.name, c.qty]));
  const side = new Map(parseList(sideText).cards.map((c) => [c.name, c.qty]));
  return parseGuide(guideText).map((row) => {
    const problems = [];
    const ins = parseSwapList(row.ins);
    const outs = parseSwapList(row.outs);
    const nIn = ins.reduce((s, c) => s + c.qty, 0);
    const nOut = outs.reduce((s, c) => s + c.qty, 0);
    if (nIn !== nOut) problems.push(`brings in ${nIn} but takes out ${nOut}, so the deck ends at ${60 + nIn - nOut}`);
    for (const c of ins) {
      const name = resolveName(c.name, [...side.keys()]);
      if (!name) problems.push(unresolved(c.name, [...side.keys()], "sideboard"));
      else {
        if (c.qty > side.get(name)) problems.push(`${c.qty} ${name} in, but the sideboard has ${side.get(name)}`);
        if (!BASIC_LANDS.has(name) && (main.get(name) ?? 0) + c.qty > 4) problems.push(`${name} would be over 4 copies`);
      }
    }
    for (const c of outs) {
      const name = resolveName(c.name, [...main.keys()]);
      if (!name) problems.push(unresolved(c.name, [...main.keys()], "main deck"));
      else if (c.qty > main.get(name)) problems.push(`${c.qty} ${name} out, but the main deck has ${main.get(name)}`);
    }
    return { opp: row.opp, nIn, nOut, problems };
  });
}

/* ------------------------------------------------------------------ report */

const T_GOOD = 0.9; // Karsten's target for casting on curve
const T_OK = 0.8;
const level = (p, good = T_GOOD, ok = T_OK) => (p >= good ? "good" : p >= ok ? "warn" : "bad");

/**
 * The full pre-test report.
 * @param {{main: string, side?: string, guide?: string, cards: object[]}} input
 */
export function pretest({ main, side = "", guide = "", cards = [] }) {
  const list = parseList(main).cards;
  const idx = indexCards(cards);
  const missing = list.filter((c) => !idx.has(c.name.toLowerCase())).map((c) => c.name);
  const rows = list.map((c) => ({ ...c, card: idx.get(c.name.toLowerCase()) ?? null }));
  const N = rows.reduce((s, r) => s + r.qty, 0);

  const isLand = (r) => (r.card ? isLandCard(r.card) : BASIC_LANDS.has(r.name));
  const landRows = rows.filter(isLand);
  const spellRows = rows.filter((r) => !isLand(r) && r.card);
  const L = landRows.reduce((s, r) => s + r.qty, 0);

  /* curve and composition */
  const reducers = spellRows.filter((r) => isCostReducer(r.card)).map((r) => ({ name: r.name, qty: r.qty, mv: Math.round(r.card.cmc ?? 0) }));
  const reducerNames = new Set(reducers.map((r) => r.name));
  const curve = [0, 1, 2, 3, 4, 5, 6].map((mv) => ({ mv: mv === 6 ? "6+" : String(mv), n: 0 }));
  let mvSum = 0;
  let spells = 0;
  for (const r of spellRows) {
    const mv = Math.round(r.card.cmc ?? 0);
    curve[Math.min(mv, 6)].n += r.qty;
    mvSum += mv * r.qty;
    spells += r.qty;
  }
  const typeOf = (r) => front(r.card)?.type_line ?? r.card.type_line ?? "";
  const creatures = spellRows.filter((r) => /\bCreature\b/.test(typeOf(r))).reduce((s, r) => s + r.qty, 0);
  const legendaryCreatures = spellRows.filter((r) => /\bLegendary\b.*\bCreature\b/.test(typeOf(r))).reduce((s, r) => s + r.qty, 0);

  /* lands: colors and how they enter */
  const entryCounts = { untapped: 0, life: 0, early: 0, late: 0, tapped: 0 };
  const sources = Object.fromEntries(WUBRG.map((c) => [c, { fixed: 0, flex: 0 }]));
  const landList = [];
  for (const r of landRows) {
    const card = r.card ?? { name: r.name, type_line: `Basic Land — ${r.name}`, produced_mana: [] };
    const { colors, flex } = landColors(card);
    const entry = landEntry(card.oracle_text ?? card.card_faces?.map((f) => f.oracle_text).join("\n"));
    entryCounts[entry] += r.qty;
    for (const c of colors) sources[c][flex ? "flex" : "fixed"] += r.qty;
    landList.push({ name: r.name, qty: r.qty, colors, flex, entry });
  }
  const untappedT1 = entryCounts.untapped + entryCounts.life + entryCounts.early;

  /* color demand: for each color, the hardest card to cast on curve */
  const colors = [];
  for (const c of WUBRG) {
    const demanding = spellRows.filter((r) => !reducerNames.has(r.name)).map((r) => ({ name: r.name, qty: r.qty, need: pips(front(r.card)?.mana_cost ?? r.card.mana_cost)[c], turn: Math.max(1, Math.round(r.card.cmc ?? 0)) })).filter((d) => d.need > 0);
    if (!demanding.length) continue;
    const S = sources[c].fixed + sources[c].flex;
    const scored = demanding.map((d) => ({ ...d, p: pColorGivenLands(N, L, Math.min(S, L), 6 + d.turn, d.need, d.turn) }));
    scored.sort((a, b) => a.p - b.p || b.need - a.need);
    const worst = scored[0];
    colors.push({
      color: c,
      name: COLOR_NAMES[c],
      sources: S,
      fixed: sources[c].fixed,
      flex: sources[c].flex,
      cards: demanding.reduce((s, d) => s + d.qty, 0),
      worst,
      level: level(worst.p),
      checks: scored.slice(0, 4),
    });
  }

  /* opening hands and land drops (on the play) */
  const handLands = Array.from({ length: 8 }, (_, k) => pExactly(N, L, 7, k));
  const hands = {
    lands: L,
    p0to1: handLands[0] + handLands[1],
    p2to4: handLands[2] + handLands[3] + handLands[4],
    p5plus: handLands.slice(5).reduce((s, p) => s + p, 0),
    pT3: pAtLeast(N, L, 9, 3),
    pT4: pAtLeast(N, L, 10, 4),
    pUntappedT1: pAny(N, untappedT1, 7),
    distribution: handLands,
  };

  /* interaction (text match, so an estimate) */
  const interactionRows = spellRows.filter((r) => isInteraction(r.card));
  const interactionCount = interactionRows.reduce((s, r) => s + r.qty, 0);
  const interaction = {
    count: interactionCount,
    cards: interactionRows.map((r) => ({ name: r.name, qty: r.qty })),
    pT3: pAny(N, interactionCount, 9),
    pT5: pAny(N, interactionCount, 11),
  };

  const plans = guide ? checkPlans(guide, main, side) : [];

  /* the headline findings, worst first */
  const flags = [];
  if (missing.length) flags.push({ level: "warn", text: `Scryfall didn't recognise ${missing.join(", ")}. Check the spelling; those cards are left out of the math.` });
  if (N < 60) flags.push({ level: "bad", text: `The main deck has ${N} cards.` });
  for (const col of colors) {
    if (col.level !== "good") {
      flags.push({
        level: col.level,
        text: `${col.name}: ${col.worst.name} needs ${col.worst.need} ${col.name.toLowerCase()} source${col.worst.need > 1 ? "s" : ""} by turn ${col.worst.turn}. With ${col.sources} sources that happens ${fmt(col.worst.p)} of the time when you hit your land drops (target 90%).`,
      });
    }
  }
  if (reducers.length) {
    flags.push({
      level: "warn",
      text: `${reducers.map((r) => `${r.qty} ${r.name}`).join(", ")} get cheaper as the game goes on. The curve shows their printed mana value, and the color check leaves them out, so judge their real cost yourself.`,
    });
  }
  if (hands.p2to4 < 0.72) flags.push({ level: "warn", text: `Only ${fmt(hands.p2to4)} of opening 7s have 2–4 lands; expect more mulligans.` });
  const oneDrops = curve[1].n;
  if (oneDrops >= 8 && hands.pUntappedT1 < 0.85) flags.push({ level: "warn", text: `${oneDrops} one-drops, but an untapped land on turn 1 only ${fmt(hands.pUntappedT1)} of the time.` });
  if (interactionCount < 6) flags.push({ level: "warn", text: `Only ${interactionCount} removal or interaction spells found in the main deck.` });
  for (const p of plans) for (const pr of p.problems) flags.push({ level: "bad", text: `Sideboard plan vs ${p.opp}: ${pr}.` });
  if (!flags.length) flags.push({ level: "good", text: "No mana, curve or sideboard-plan problems found." });
  flags.sort((a, b) => ["bad", "warn", "good"].indexOf(a.level) - ["bad", "warn", "good"].indexOf(b.level));

  return {
    total: N,
    lands: L,
    spells,
    creatures,
    legendaryCreatures,
    avgMV: spells ? mvSum / spells : 0,
    curve,
    reducers,
    colors,
    landList,
    entryCounts,
    untappedT1,
    hands,
    interaction,
    plans,
    missing,
    flags,
  };
}

const fmt = (p) => `${(100 * p).toFixed(1)}%`;
