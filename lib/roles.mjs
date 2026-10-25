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
import { RULES as EDGE_RULES, ownText, typeOf } from "./autoedges.mjs";

/**
 * The tracker's auto-edge rules plus three from the method prototype that link one rare card to
 * many (so they'd flood the drawn synergy graph, but they matter for roles).
 */
const pt = (c, k) => Number(c[k] ?? c.card_faces?.[0]?.[k] ?? NaN);
const EXTRA_RULES = [
  [
    "deathtouch",
    "a deathtouch creature makes it deadly",
    (c, t, ty) => /\bCreature\b/.test(ty.split(" // ")[0]) && ((c.keywords ?? []).includes("Deathtouch") || /(^|\n)([A-Za-z]+, )*deathtouch\b/i.test(t)),
    // payoffs: "creature with deathtouch" conditions (The Serpent Society), and bites, where deathtouch kills anything
    (c, t) => /(creature|creatures) (you control )?with deathtouch|target creature you control deals damage equal to its power|deals damage equal to its power to (target|another target|up to one target) creature/i.test(t),
  ],
  [
    "smallrecast",
    "it can be cast again from your graveyard",
    (c, t) => /cast creature spells with power or toughness 1 or less from your graveyard/i.test(t),
    (c, t, ty) => /\bCreature\b/.test(ty.split(" // ")[0]) && (pt(c, "power") <= 1 || pt(c, "toughness") <= 1),
  ],
  [
    "returner",
    "it gets back a creature you gave away",
    (c, t) => /exile target (nontoken )?creature[^.]*\. return (it|that card) to the battlefield under its owner's control|return target creature an opponent controls to its owner's hand/i.test(t),
    (c, t) => /gains control of this|gains control of target permanent you control/i.test(t),
  ],
  [
    "loop",
    "their lifegain and life loss feed each other",
    (c, t) => /whenever you gain life, each opponent loses/i.test(t),
    (c, t) => /whenever an opponent loses life, you gain/i.test(t),
  ],
];
/**
 * Trigger doublers, one role per condition: Delney doubles small creatures, Splinter only Ninjas,
 * Annie Joins Up only legends. Putting them in one role would link Splinter to every small creature.
 */
const front = (ty) => ty.split(" // ")[0];
const triggered = (t, ty) => /\bCreature\b/.test(front(ty)) && /(^|\n)\s*(Landfall [^,]*, ?)?(When|Whenever|At the beginning)\b/.test(t);
const isType = (t, ty, tribe) => new RegExp(`\\b${tribe}\\b`).test(front(ty).split(" — ")[1] ?? "") || /\bchangeling\b|every creature type/i.test(t);
export const TRIBAL_DOUBLERS = ["Ninja", "Ally", "Dwarf", "Elemental"];
const DOUBLER_RULES = [
  [
    "doubler",
    "it makes their triggers happen twice (power 2 or less)",
    (c, t) => /triggered ability of a creature you control with power 2 or less/i.test(t),
    (c, t, ty) => triggered(t, ty) && (Number(c.power ?? c.card_faces?.[0]?.power ?? 9) || 0) <= 2,
  ],
  [
    "doubler-legend",
    "it makes legends' triggers happen twice",
    (c, t) => /triggered ability of a legendary creature you control triggers/i.test(t),
    (c, t, ty) => triggered(t, ty) && /\bLegendary\b/.test(front(ty)),
  ],
  ...TRIBAL_DOUBLERS.map((tribe) => [
    `doubler-${tribe.toLowerCase()}`,
    `it makes ${tribe}s' triggers happen twice`,
    (c, t) => new RegExp(`triggered ability of (a|an|another) ${tribe}( creature)? you control triggers`, "i").test(t),
    (c, t, ty) => triggered(t, ty) && isType(t, ty, tribe),
  ]),
  [
    "doubler-enter",
    "it doubles enter triggers",
    (c, t) => /if a permanent entering (the battlefield )?causes a triggered ability/i.test(t),
    (c, t) => /(^|\n)\s*(When|Whenever)[^,]*\benters?\b/.test(t),
  ],
];
export const RULES = [...EDGE_RULES, ...EXTRA_RULES, ...DOUBLER_RULES];
/**
 * Roles where the rare card is the producer: one Delney doubles every small creature's trigger,
 * so value grows with the payoffs and saturates in producers. The sides swap in the math.
 */
export const REVERSED = new Set([...DOUBLER_RULES.map(([id]) => id), "smallrecast"]);
/** Layer value with REVERSED handled. */
export const roleValue = (id, P, Q, opts) => (REVERSED.has(id) ? layerValue(Q, P, opts) : layerValue(P, Q, opts));
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
  deathtouch: "deathtouch creatures",
  smallrecast: "small creatures recast from the graveyard",
  doubler: "extra triggers",
  "doubler-legend": "extra legend triggers",
  ...Object.fromEntries(TRIBAL_DOUBLERS.map((x) => [`doubler-${x.toLowerCase()}`, `extra ${x} triggers`])),
  "doubler-enter": "extra enter triggers",
  returner: "creatures returned to you",
  loop: "lifegain ↔ life-loss loops",
};
const LABEL = Object.fromEntries(RULES.map(([id, label]) => [id, label]));
/** Short names for the role headings. */
export const NAME = {
  spells: "Spells matter", noncreature: "Noncreature spells", discard: "Discard", legend: "Legends", reentry: "Enter effects",
  landfall: "Landfall", fodder: "Sacrifice", treasure: "Treasure", evasion: "Evasive hits", flying: "Flyers", drain: "Drain",
  tappers: "Crew and tap costs", recursion: "Recursion", lifegain: "Lifegain", counters: "+1/+1 counters", steal: "Casting their cards",
  connect: "Combat-damage triggers", theirgy: "Their graveyard", seconddraw: "Second card drawn", lifeloss: "Opponent loses life", selffill: "Your graveyard",
  deathtouch: "Deathtouch", smallrecast: "Recast small creatures", doubler: "Trigger doubling (small creatures)", "doubler-legend": "Legend trigger doubling", "doubler-enter": "Enter-trigger doubling",
  ...Object.fromEntries(TRIBAL_DOUBLERS.map((x) => [`doubler-${x.toLowerCase()}`, `${x} trigger doubling`])), returner: "Getting it back", loop: "Drain loop",
};

/**
 * Colors you need to cast it: its mana cost, where a hybrid pip ({U/B}) needs either color and
 * {2/W} or {W/P} need none. Splinter ({1}{W/B}{W/B}, with a {1}{U} ability) casts in W/B or mono-B.
 * The ability's color doesn't count, as color identity would (that's a Commander rule).
 */
export function castableIn(card, colors) {
  const costs = [card.mana_cost, ...(card.card_faces ?? []).slice(0, 1).map((f) => f.mana_cost)].filter((x) => x != null && x !== "");
  const cost = costs[0] ?? "";
  for (const [, sym] of String(cost).matchAll(/\{([^}]+)\}/g)) {
    const parts = sym.split("/");
    if (parts.length === 1) {
      if ("WUBRG".includes(sym) && !colors.has(sym)) return false;
    } else if (!parts.some((x) => !"WUBRG".includes(x) || colors.has(x))) return false;
  }
  return true;
}
/** Colors a card asks for when cast; a hybrid pip counts for both. */
export const costColors = (card) => [...new Set([...String(card.mana_cost ?? card.card_faces?.[0]?.mana_cost ?? "").matchAll(/\{([^}]+)\}/g)].flatMap(([, s]) => s.split("/").filter((x) => "WUBRG".includes(x))))];

export const isLand = (card) => /\bLand\b/.test(typeOf(card).split(" // ")[0]);
export const legendary = (card) => /\bLegendary\b/.test(typeOf(card).split(" // ")[0]);
const maxCopies = (card) => (legendary(card) ? 3 : 4);

/** A card as the role math sees it. */
export function view(card, copies = 0) {
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
  // the colors the deck's spells actually ask for (non-hybrid pips); color identity would count
  // Splinter's {1}{U} ability and Krang's hybrid {U/B} as blue
  for (const v of views) if (!v.land) for (const [, c] of String(v.card.mana_cost ?? v.card.card_faces?.[0]?.mana_cost ?? "").matchAll(/\{([WUBRG])\}/g)) s.add(c);
  if (!s.size) for (const v of views) if (!v.land) for (const c of v.card.color_identity ?? v.card.colors ?? []) s.add(c);
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
    .filter((c) => castableIn(c, colors) && (c.cmc ?? 0) <= 6 && !isLand(c))
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
    return spec[id] * roleValue(id, s.P, s.Q, { base: id === "landfall" ? landBase : 0, seen, deckSize });
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
    const bothCopies = s.Q.filter((v) => s.P.includes(v)).reduce((a, v) => a + v.copies, 0);
    const base = id === "landfall" ? landBase : 0;
    const rev = REVERSED.has(id);
    const b = bestSplit(pc + qc, { base, seen, deckSize });
    const split = rev ? { producers: b.payoffs, payoffs: b.producers } : { producers: b.producers, payoffs: b.payoffs };
    // the saturating side is the one to compare: payoffs normally, producers for a reversed role
    const [have, want] = rev ? [pc, split.producers] : [qc, split.payoffs];
    const verdict =
      pc === 0 && base === 0
        ? "No producers: nothing in the deck triggers these payoffs."
        : have < want - 2
          ? rev ? "Room for more producers." : "Room for more payoffs."
          : have > want + 2
            ? rev ? "Producer-heavy: more payoffs would use them more." : "Payoff-heavy: more producers would fire them more often."
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
      bothCopies,
      reversed: rev,
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
    const front = (n) => n.split(" // ")[0];
    const row = list.find((c) => c.name === out || front(c.name) === front(out));
    if (!row || list.some((c) => front(c.name) === front(inn))) continue;
    row.name = inn;
  }
  return { text: list.map((c) => `${c.qty} ${c.name}`).join("\n"), count: list.reduce((s, c) => s + c.qty, 0) };
}
