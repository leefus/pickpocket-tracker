/**
 * Roles: the deck's synergy graph, grouped by what each card does.
 *
 * Every auto-edge rule links ALL its producers to ALL its payoffs, so the cards
 * on one side of one rule are interchangeable there (claude/RoleQuotientCheck.lean,
 * producers_are_twins). We merge them into one role node and score each rule
 * ("layer") in its own unit:
 *
 *   F = A × B
 *   A = producer copies, each scaled by timing m(cmc)        more producers → more triggers (linear)
 *   B = P(≥ 1 payoff in the first `seen` cards) × payoff quality   a 2nd payoff is mostly a backup (saturates)
 *
 * The best producers : payoffs split for a layer comes straight out of that
 * (about 3 : 1; Lean: best_split_12). Candidates for each role come from the
 * Standard pool and are ranked by how much they add to the whole deck's score,
 * so a card that is in two roles ranks higher. Pure, so it runs under node --test.
 */
import { parseList } from "./decklist.mjs";
import { indexCards, pAny } from "./pretest.mjs";
import { RULES, ownText, typeOf } from "./autoedges.mjs";
import { harmsOf } from "./harm.mjs";

export const T_END = 8; // a typical game is over by turn 8
export const SEEN = 10; // cards seen by turn 4 on the play (7 + 3 draws)
export const timing = (cmc) => Math.max(0.05, (T_END - Math.max(1, cmc ?? 0)) / (T_END - 1));

export const UNIT = {
  spells: "instants and sorceries cast",
  noncreature: "noncreature spells cast",
  discard: "cards discarded",
  legend: "legends entering",
  reentry: "enter effects re-used",
  landfall: "lands entering",
  fodder: "bodies to sacrifice",
  treasure: "Treasures",
  evasion: "evasive hits",
  flying: "flyers",
  drain: "life drained",
  tappers: "creatures to tap",
  recursion: "creatures returned",
  lifegain: "lifegain events",
  counters: "+1/+1 counters",
  steal: "their cards cast",
  connect: "hits connected",
  theirgy: "cards in their graveyard",
  seconddraw: "second-card draws",
  lifeloss: "opponent life-loss events",
  selffill: "cards into your graveyard",
};
const LABEL = Object.fromEntries(RULES.map(([id, label]) => [id, label]));
/** Short names for the role headings. */
export const NAME = {
  spells: "Spells matter", noncreature: "Noncreature spells", discard: "Discard", legend: "Legends", reentry: "Enter effects",
  landfall: "Landfall", fodder: "Sacrifice", treasure: "Treasure", evasion: "Evasive hits", flying: "Flyers", drain: "Drain",
  tappers: "Crew and tap costs", recursion: "Recursion", lifegain: "Lifegain", counters: "+1/+1 counters", steal: "Casting their cards",
  connect: "Combat-damage triggers", theirgy: "Their graveyard", seconddraw: "Second card drawn", lifeloss: "Opponent loses life", selffill: "Your graveyard",
};

const isLand = (card) => /\bLand\b/.test(typeOf(card).split(" // ")[0]);
const legendary = (card) => /\bLegendary\b/.test(typeOf(card).split(" // ")[0]);
const maxCopies = (card) => (legendary(card) ? 3 : 4);

/** A card as the role math sees it. */
function view(card, copies = 0) {
  const t = ownText(card);
  const ty = typeOf(card);
  const cmc = card.cmc ?? 0;
  return { name: card.name.split(" // ")[0], card, copies, cmc, land: isLand(card), t, ty, m: timing(cmc), harms: harmsOf(card).length };
}

/** Which side of which layer a card is on. */
export function rolesOf(v) {
  const out = [];
  if (v.land) return out;
  for (const [id, , produces, pays] of RULES) {
    if (produces(v.card, v.t, v.ty)) out.push({ id, side: "P" });
    if (pays(v.card, v.t, v.ty)) out.push({ id, side: "Q" });
  }
  return out;
}

/**
 * Value of one layer. producers/payoffs: [{copies, m, harms}]. base: free producers
 * (for landfall, every land drop is one).
 */
export function layerValue(producers, payoffs, { base = 0, seen = SEEN, deckSize = 60 } = {}) {
  const A = base + producers.reduce((s, p) => s + p.copies * p.m, 0);
  const k = payoffs.reduce((s, q) => s + q.copies, 0);
  if (!A || !k) return 0;
  const quality = payoffs.reduce((s, q) => s + q.copies * q.m * (1 + q.harms), 0) / k;
  return A * pAny(deckSize, k, seen) * quality;
}

/**
 * Best number of payoff copies out of n copies in a layer, for value (base + producers) × P(≥1 payoff).
 * Ties go to fewer payoffs.
 */
export function bestSplit(n, { base = 0, seen = SEEN, deckSize = 60 } = {}) {
  let best = { payoffs: 0, producers: n, value: 0 };
  for (let q = 0; q <= n; q++) {
    const value = (base + n - q) * pAny(deckSize, q, seen);
    if (value > best.value + 1e-12) best = { payoffs: q, producers: n - q, value };
  }
  return best;
}

/** Colors of the deck's nonland cards (their color identities). */
function deckColors(views) {
  const s = new Set();
  for (const v of views) if (!v.land) for (const c of v.card.color_identity ?? v.card.colors ?? []) s.add(c);
  return s;
}

/**
 * @param {string} mainText Arena-format main deck
 * @param {object[]} cards Scryfall data for the deck's cards
 * @param {object[]} pool Standard pool (nonland cards), e.g. lib/data/standard-pool.json .cards
 */
export function deckRoles(mainText, cards, pool = [], { seen = SEEN, perRole = 12 } = {}) {
  const idx = indexCards(cards);
  const list = parseList(mainText).cards;
  const deckSize = list.reduce((s, c) => s + c.qty, 0) || 60;
  const deck = list.map((c) => (idx.get(c.name.toLowerCase()) ? view(idx.get(c.name.toLowerCase()), c.qty) : null)).filter(Boolean);
  const inDeck = new Set(deck.map((v) => v.name));
  const colors = deckColors(deck);
  const lands = deck.filter((v) => v.land);
  // Each land drop is a landfall trigger; a fetch land makes two.
  const landBase = lands.reduce((s, v) => s + v.copies * (/search your library for a basic land/i.test(v.t) ? 2 : 1), 0);

  const deckRolesOf = new Map(deck.map((v) => [v.name, rolesOf(v)]));
  const candidates = pool
    .filter((c) => (c.color_identity ?? []).every((x) => colors.has(x)) && (c.cmc ?? 0) <= 6 && !isLand(c))
    .map((c) => view(c, maxCopies(c)))
    .filter((v) => !inDeck.has(v.name));
  const candRoles = new Map(candidates.map((v) => [v.name, rolesOf(v)]));

  // Specificity: a rule that links everything to everything says little (same formula as the method).
  const N = candidates.length + deck.length || 1;
  const spec = {};
  for (const [id] of RULES) {
    let P = 0, Q = 0;
    for (const [, rs] of [...deckRolesOf, ...candRoles]) {
      if (rs.some((r) => r.id === id && r.side === "P")) P++;
      if (rs.some((r) => r.id === id && r.side === "Q")) Q++;
    }
    spec[id] = P && Q ? Math.max(0.05, Math.log((N * N) / (P * Q)) / Math.log(N * N)) : 0.05;
  }

  const sides = (members, id) => ({
    P: members.filter((v) => (v.roles ?? deckRolesOf.get(v.name)).some((r) => r.id === id && r.side === "P")),
    Q: members.filter((v) => (v.roles ?? deckRolesOf.get(v.name)).some((r) => r.id === id && r.side === "Q")),
  });
  const valueOf = (members, id) => {
    const s = sides(members, id);
    return spec[id] * layerValue(s.P, s.Q, { base: id === "landfall" ? landBase : 0, seen, deckSize });
  };
  const nonland = deck.filter((v) => !v.land);
  const active = RULES.map(([id]) => id).filter((id) => sides(nonland, id).Q.length > 0);
  const total = (members) => active.reduce((s, id) => s + valueOf(members, id), 0);
  const F0 = total(nonland);

  const layers = active.map((id) => {
    const s = sides(nonland, id);
    const F = valueOf(nonland, id);
    const pc = s.P.reduce((a, v) => a + v.copies, 0);
    const qc = s.Q.filter((v) => !s.P.includes(v)).reduce((a, v) => a + v.copies, 0); // a card on both sides counts as a producer
    const base = id === "landfall" ? landBase : 0;
    const split = bestSplit(pc + qc, { base, seen, deckSize });
    const verdict =
      pc === 0 && base === 0
        ? "No producers: nothing in the deck triggers these payoffs."
        : qc < split.payoffs - 2
          ? "Room for more payoffs."
          : qc > split.payoffs + 2
            ? "Payoff-heavy: more producers would fire them more often."
            : "Balanced.";
    // a member's worth: how much the whole deck's score drops without it
    const member = (v) => ({
      name: v.name,
      copies: v.copies,
      cmc: v.cmc,
      both: s.P.includes(v) && s.Q.includes(v),
      worth: +(F0 - total(nonland.filter((x) => x !== v))).toFixed(2),
    });
    const ranked = (side) => {
      const pool = candidates.filter((v) => candRoles.get(v.name).some((r) => r.id === id && r.side === side));
      return pool
        .map((v) => {
          const roles = candRoles.get(v.name);
          const gain = total([...nonland, { ...v, roles }]) - F0;
          return { name: v.name, cmc: v.cmc, copies: v.copies, gain: +gain.toFixed(2), alsoIn: [...new Set(roles.map((r) => r.id))].filter((x) => x !== id && active.includes(x)) };
        })
        .sort((a, b) => b.gain - a.gain || a.cmc - b.cmc || a.name.localeCompare(b.name))
        .slice(0, perRole);
    };
    return {
      id,
      name: NAME[id] ?? id,
      label: LABEL[id],
      unit: UNIT[id] ?? id,
      spec: +spec[id].toFixed(2),
      F: +F.toFixed(2),
      base,
      producers: s.P.map(member).sort((a, b) => a.worth - b.worth),
      payoffs: s.Q.map(member).sort((a, b) => a.worth - b.worth),
      producerCopies: pc,
      payoffCopies: qc,
      split: { producers: split.producers, payoffs: split.payoffs },
      verdict,
      candidates: { P: ranked("P"), Q: ranked("Q") },
    };
  });
  layers.sort((a, b) => b.F - a.F);
  return { colors: [...colors].sort(), total: +F0.toFixed(2), landBase, nonland: nonland.map((v) => v.name), layers };
}

/** Apply swaps [{out, in}] to an Arena list. The new card takes the old card's place and its number of copies, so the deck stays the same size. */
export function applySwaps(mainText, swaps) {
  const list = parseList(mainText).cards.map((c) => ({ ...c }));
  for (const { out, in: inn } of swaps) {
    const row = list.find((c) => c.name === out);
    if (!row || list.some((c) => c.name === inn)) continue;
    row.name = inn;
  }
  return { text: list.map((c) => `${c.qty} ${c.name}`).join("\n"), count: list.reduce((s, c) => s + c.qty, 0) };
}
