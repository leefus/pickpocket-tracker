/**
 * Build a 60-card deck from one or more seed cards: the deck-graph method
 * (claude/graph_method_v2.md), role-quotient version, as one pure function.
 *
 *   1. Pool: Standard nonland cards in the chosen colors, MV ≤ 6.
 *   2. The seeds' needs: the roles where a seed is a payoff ("what supports it").
 *      Those roles count ×boost. The user can change them.
 *   3. Look-alikes ("twins"): cards whose text and roles resemble each seed's.
 *   4. Grow from the seeds: add the card with the biggest gain in the role score
 *      Σ spec × boost × A × B (lib/roles.mjs), minus conflicts. No pruning, so
 *      redundancy is kept, and the producers : payoffs split comes out of the draw odds.
 *   5. Interaction slots, if asked: the cheapest removal in the colors. The graph can't value these.
 *   6. Land count from the curve (Frank Karsten's 60-card rule of thumb), duals that make
 *      only the deck's colors (untapped first), basics split by colored pips.
 * Pure, so it runs under node --test.
 */
import { isFetchLand, isInteraction, landEntry, pips } from "./pretest.mjs";
import { NAME, REVERSED, RULES, SEEN, applySwaps, deckRoles, roleValue, legendary, rolesOf, view } from "./roles.mjs";
import { buildDeck, compareSwaps, killTurns, summary } from "./goldfish.mjs";
import { BASIC_LANDS as BASIC_NAMES, parseList } from "./decklist.mjs";
import { _internal, algebraicConnectivity, components, cutVertices } from "./graph.mjs";

const BASIC = { W: "Plains", U: "Island", B: "Swamp", R: "Mountain", G: "Forest" };
const short = (n) => n.split(" // ")[0];

/* ---------- look-alikes: TF-IDF text cosine + role Jaccard, as in the method prototype ---------- */
const STOP = new Set("a an the of to and or this that it its you your target card cards creature creatures with for on in from into each until end turn if then may can is are be as at by when whenever another other one two three put get gets has have".split(" "));
const tokens = (t) => t.toLowerCase().replace(/\{[^}]*\}/g, " sym ").replace(/[0-9]+/g, " N ").split(/[^a-z+\-/]+/).filter((w) => w.length > 2 && !STOP.has(w));

function twinFinder(views, rolesBy) {
  const docs = new Map(views.map((v) => [v.name, tokens(v.t)]));
  const df = new Map();
  for (const ws of docs.values()) for (const w of new Set(ws)) df.set(w, (df.get(w) ?? 0) + 1);
  const N = views.length || 1;
  const vec = (n) => {
    const m = new Map();
    for (const w of docs.get(n) ?? []) m.set(w, (m.get(w) ?? 0) + 1);
    for (const [w, c] of m) m.set(w, c * Math.log(N / (df.get(w) ?? 1)));
    return m;
  };
  const norm = (m) => Math.sqrt([...m.values()].reduce((a, b) => a + b * b, 0)) || 1;
  const key = (r) => `${r.side}:${r.id}`;
  return (seed, k = 5) => {
    const A = vec(seed), nA = norm(A);
    const RA = new Set((rolesBy.get(seed) ?? []).map(key));
    return views
      .filter((v) => v.name !== seed)
      .map((v) => {
        const B = vec(v.name);
        let d = 0;
        for (const [w, x] of A) if (B.has(w)) d += x * B.get(w);
        const RB = new Set((rolesBy.get(v.name) ?? []).map(key));
        let i = 0;
        for (const r of RA) if (RB.has(r)) i++;
        const role = RA.size + RB.size - i ? i / (RA.size + RB.size - i) : 0;
        const text = d / (nA * norm(B));
        return { name: v.name, text: +text.toFixed(2), role: +role.toFixed(2), sim: +(0.5 * text + 0.5 * role).toFixed(3) };
      })
      .sort((a, b) => b.sim - a.sim)
      .slice(0, k);
  };
}

/* ---------- conflicts the role score subtracts ---------- */
const HINDERS = [
  { id: "tokenreplace", why: "replaces your Treasures", test: (h) => /if one or more artifact tokens would be created/i.test(h.t), hurts: (v, R) => R.some((r) => r.id === "treasure" && r.side === "Q") },
  { id: "exileinstead", why: "exiles instead of dying", test: (h) => /would die, exile it instead/i.test(h.t), hurts: (v) => /whenever (a|another) (nontoken )?creature( you control)? dies|when this creature dies/i.test(v.t) },
  { id: "wipe", why: "kills your own creatures", test: (h) => /destroy all creatures|damage to each creature|all creatures get -/i.test(h.t), hurts: (v) => /\bCreature\b/.test(v.ty.split(" // ")[0]) },
];

/** Share of the pool on the payoff side of each role. A role where 1 card in 5 is a "payoff" (any creature with an enter trigger) says little about a seed. */
const shareCache = new WeakMap();
export function payoffShare(pool) {
  if (shareCache.has(pool)) return shareCache.get(pool);
  const n = { P: {}, Q: {} };
  for (const c of pool) for (const r of rolesOf(view(c))) n[r.side][r.id] = (n[r.side][r.id] ?? 0) + 1;
  const f = (side) => Object.fromEntries(RULES.map(([id]) => [id, (n[side][id] ?? 0) / Math.max(1, pool.length)]));
  const out = { P: f("P"), Q: f("Q") };
  shareCache.set(pool, out);
  return out;
}
export const INCIDENTAL = 0.05; // payoff side shared by more than 5% of Standard: not a real need

/** Seeds' colors, roles and needs, before building. */
export function seedInfo(seedNames, pool) {
  const byName = new Map(pool.map((c) => [short(c.name).toLowerCase(), c]));
  const seeds = [], missing = [];
  for (const n of seedNames.map((s) => String(s).trim()).filter(Boolean)) {
    const c = byName.get(n.toLowerCase());
    if (c && !seeds.some((v) => v.card === c)) seeds.push(view(c, legendary(c) ? 3 : 4));
    else if (!c) missing.push(n);
  }
  const share = payoffShare(pool);
  const colors = [...new Set(seeds.flatMap((v) => v.card.color_identity ?? []))].sort();
  const roles = seeds.map((v) => ({ name: v.name, cmc: v.cmc, colors: v.card.color_identity ?? [], roles: rolesOf(v) }));
  const uses = [...new Set(roles.flatMap((s) => s.roles.filter((r) => r.side === "Q").map((r) => r.id)))];
  const needs = new Set();
  for (const s of roles) {
    // what supports it: roles where the seed is a payoff, unless that payoff side is common
    const pays = s.roles.filter((r) => r.side === "Q" && share.Q[r.id] <= INCIDENTAL).map((r) => r.id);
    // an enabler with no real payoff role (Delney) needs payoffs for the rare thing it makes
    const makes = pays.length ? [] : s.roles.filter((r) => r.side === "P" && share.P[r.id] <= INCIDENTAL / 2).map((r) => r.id);
    for (const id of [...pays, ...makes]) needs.add(id);
  }
  const all = [...new Set(roles.flatMap((s) => s.roles.map((r) => r.id)))];
  const other = all.filter((id) => !needs.has(id));
  return { seeds: roles, missing, colors, needs: [...needs], other, names: Object.fromEntries(all.map((id) => [id, NAME[id] ?? id])), share: Object.fromEntries(all.map((id) => [id, { P: +share.P[id].toFixed(3), Q: +share.Q[id].toFixed(3) }])) };
}

/** Karsten's rule of thumb for 60 cards: 19.59 + 1.90 × average MV − 0.28 × cheap draw/ramp, clamped to 20–27. */
export const landCount = (avgMV, cheapDraw = 0) => Math.min(27, Math.max(20, Math.round(19.59 + 1.9 * avgMV - 0.28 * cheapDraw)));

/**
 * @param {object} o
 * @param {string[]} o.seeds seed card names
 * @param {object[]} o.pool Standard nonland pool; o.landPool nonbasic Standard lands
 * @param {string[]} [o.colors] default: the seeds' colors
 * @param {string[]} [o.needs] default: the roles where a seed is a payoff
 * @param {number} [o.removal=4] copies reserved for interaction
 * @param {number} [o.twins=0] look-alikes added per seed
 */
export function buildFromSeeds({ seeds: seedNames, pool, landPool = [], colors, needs, boost = 5, removal = 4, twins = 0, seen = SEEN }) {
  const info = seedInfo(seedNames, pool);
  if (!info.seeds.length) return { error: "None of those seeds are Standard nonland cards." };
  const C = new Set(colors?.length ? colors : info.colors);
  const NEEDS = new Set(needs ?? info.needs);
  const views = pool
    .filter((c) => (c.color_identity ?? []).every((x) => C.has(x)) && (c.cmc ?? 0) <= 6)
    .map((c) => view(c, legendary(c) ? 3 : 4));
  const byName = new Map(views.map((v) => [v.name, v]));
  const seeds = info.seeds.map((s) => byName.get(s.name)).filter(Boolean);
  if (seeds.length < info.seeds.length) return { error: "A seed is outside the chosen colors." };
  const rolesBy = new Map(views.map((v) => [v.name, rolesOf(v)]));

  // specificity of each role over this pool
  const N = views.length;
  const spec = {};
  for (const [id] of RULES) {
    let P = 0, Q = 0;
    for (const rs of rolesBy.values()) {
      if (rs.some((r) => r.id === id && r.side === "P")) P++;
      if (rs.some((r) => r.id === id && r.side === "Q")) Q++;
    }
    spec[id] = P && Q ? Math.max(0.05, Math.log((N * N) / (P * Q)) / Math.log(N * N)) : 0.05;
  }
  const hinderOf = new Map(views.map((v) => [v.name, HINDERS.filter((h) => h.test(v))]));
  const LAND_BASE = 24; // land drops count as landfall producers; the exact land count comes at the end

  const layerF = (id, S) => {
    const P = [], Q = [];
    for (const v of S) for (const r of rolesBy.get(v.name)) if (r.id === id) (r.side === "P" ? P : Q).push(v);
    return spec[id] * (NEEDS.has(id) ? boost : 1) * roleValue(id, P, Q, { base: id === "landfall" ? LAND_BASE : 0, seen });
  };
  const conflicts = (x, S) => {
    let pen = 0;
    const why = [];
    for (const v of S) {
      for (const h of hinderOf.get(x.name)) if (h.hurts(v, rolesBy.get(v.name))) (pen += h.id === "wipe" ? 0.15 : 0.5), why.push(`${x.name} ${h.why} (${v.name})`);
      for (const h of hinderOf.get(v.name)) if (h.hurts(x, rolesBy.get(x.name))) (pen += h.id === "wipe" ? 0.15 : 0.5), why.push(`${v.name} ${h.why} (${x.name})`);
    }
    return { pen, why };
  };

  const S = [...seeds];
  const log = seeds.map((v) => ({ step: "seed", name: v.name, copies: v.copies, cmc: v.cmc, roles: rolesBy.get(v.name).map((r) => `${r.side === "P" ? "makes" : "uses"} ${NAME[r.id] ?? r.id}`) }));
  const twinOf = twinFinder(views, rolesBy);
  const twinTable = Object.fromEntries(seeds.map((s) => [s.name, twinOf(s.name, 5)]));
  for (const s of seeds) for (const t of twinTable[s.name].slice(0, twins)) {
    const v = byName.get(t.name);
    if (v && !S.includes(v)) S.push(v), log.push({ step: "twin", name: v.name, copies: v.copies, cmc: v.cmc, why: `looks like ${s.name} (text ${t.text}, roles ${t.role})` });
  }

  // Must-haves: a need whose producers are rare (≤ 1% of Standard, e.g. "get Kain back") gets its best
  // producer placed first. Growth would miss a needle like Getaway Glamer: it links to one card only.
  const share = payoffShare(pool);
  for (const id of NEEDS) {
    const seedPays = seeds.some((sd) => rolesBy.get(sd.name).some((r) => r.id === id && r.side === "Q"));
    if (!seedPays || REVERSED.has(id) || share.P[id] > 0.01) continue;
    if (S.some((v) => rolesBy.get(v.name).some((r) => r.id === id && r.side === "P"))) continue;
    const best = views
      .filter((v) => !S.includes(v) && rolesBy.get(v.name).some((r) => r.id === id && r.side === "P"))
      .map((v) => ({ v, g: layerF(id, [...S, v]) - layerF(id, S) }))
      .sort((a, b) => b.g - a.g || a.v.cmc - b.v.cmc)[0];
    if (best) S.push(best.v), log.push({ step: "must", name: best.v.name, copies: best.v.copies, cmc: best.v.cmc, why: `the only kind of card that gives a seed its ${NAME[id] ?? id}` });
  }

  // Interaction: instants, then sorceries, then the rest; cheapest first, then the most harm kinds.
  const kind = (v) => (/\bInstant\b/.test(v.ty) ? 0 : /\bSorcery\b/.test(v.ty) ? 1 : 2);
  const interaction = [];
  for (let left = Math.max(0, removal); left > 0; ) {
    const pick = views
      .filter((v) => !S.includes(v) && !interaction.some((x) => x.v === v) && v.cmc <= 3 && isInteraction(v.card))
      .sort((a, b) => kind(a) - kind(b) || a.cmc - b.cmc || b.harms - a.harms || a.name.localeCompare(b.name))[0];
    if (!pick) break;
    const k = Math.min(4, left);
    interaction.push({ v: pick, copies: k });
    left -= k;
  }

  // Grow. Copies are what the deck spends; keep going until ~40 nonland copies, then trim to the land count.
  const copiesOf = () => S.reduce((s, v) => s + v.copies, 0) + interaction.reduce((s, x) => s + x.copies, 0);
  const allLayers = RULES.map(([id]) => id);
  let F = allLayers.reduce((s, id) => s + layerF(id, S), 0);
  while (copiesOf() < 40) {
    let best = null;
    for (const x of views) {
      if (S.includes(x) || interaction.some((i) => i.v === x)) continue;
      const R = rolesBy.get(x.name);
      if (!R.length) continue;
      const T = [...S, x];
      let g = 0;
      for (const id of new Set(R.map((r) => r.id))) g += layerF(id, T) - layerF(id, S);
      const c = conflicts(x, S);
      g -= c.pen;
      if (g > (best?.g ?? 1e-9)) best = { x, g, c };
    }
    if (!best) break;
    S.push(best.x);
    F += best.g;
    const R = rolesBy.get(best.x.name);
    const why = [...new Set(R.filter((r) => layerF(r.id, S) > 0).map((r) => `${r.side === "P" ? "makes" : "uses"} ${NAME[r.id] ?? r.id}`))];
    log.push({ step: "add", name: best.x.name, copies: best.x.copies, cmc: best.x.cmc, gain: +best.g.toFixed(2), roles: why, conflicts: best.c.why });
  }
  const stoppedEarly = copiesOf() < 40;

  // Land count from the curve, then trim the last-added cards to fit 60.
  const nonland = [...S.map((v) => ({ v, copies: v.copies })), ...interaction.map((x) => ({ ...x, interaction: true }))];
  const avg = (rows) => rows.reduce((s, r) => s + r.copies * r.v.cmc, 0) / Math.max(1, rows.reduce((s, r) => s + r.copies, 0));
  const cheapDraw = nonland.filter((r) => r.v.cmc <= 2 && /draw (a|two) cards?|search your library for (a|up to one) basic land/i.test(r.v.t)).reduce((s, r) => s + r.copies, 0);
  // Landfall decks want land drops: every land is a producer, so at least 24 (the real Mono-Green Landfall list runs 25).
  let L = Math.max(landCount(avg(nonland), cheapDraw), NEEDS.has("landfall") ? 24 : 0);
  const keep = [];
  const musts = new Set(log.filter((l) => l.step === "must").map((l) => l.name));
  const fixed = nonland.filter((r) => r.interaction || seeds.includes(r.v) || musts.has(r.v.name));
  let budget = 60 - L - fixed.reduce((s, r) => s + r.copies, 0);
  for (const r of nonland.filter((r) => !fixed.includes(r))) {
    if (budget <= 0) break;
    const k = Math.min(r.copies, budget);
    keep.push({ ...r, copies: k });
    budget -= k;
  }
  if (budget > 0) L += budget; // not enough synergy cards: more lands rather than filler
  const finalRows = [...fixed.filter((r) => !r.interaction), ...keep, ...fixed.filter((r) => r.interaction)];
  for (const l of log) {
    const row = finalRows.find((r) => r.v.name === l.name);
    l.kept = row ? row.copies : 0;
  }

  // Mana base
  const demand = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const r of finalRows) {
    const p = pips(r.v.card.mana_cost ?? r.v.card.card_faces?.[0]?.mana_cost);
    for (const c of Object.keys(demand)) demand[c] += p[c] * r.copies;
  }
  const used = Object.keys(demand).filter((c) => demand[c] > 0 && C.has(c));
  const lands = manaBase(L, used, demand, landPool, { landfall: NEEDS.has("landfall") });

  const rank = (r) => r.v.cmc;
  const line = (n, name) => `${n} ${name}`;
  const main = [
    ...finalRows.filter((r) => seeds.includes(r.v)).map((r) => line(r.copies, r.v.name)),
    ...finalRows.filter((r) => !seeds.includes(r.v)).sort((a, b) => rank(a) - rank(b) || a.v.name.localeCompare(b.v.name)).map((r) => line(r.copies, r.v.name)),
    ...lands.map((l) => line(l.copies, l.name)),
  ].join("\n");

  return {
    main,
    colors: [...C].sort(),
    needs: [...NEEDS],
    landCount: L,
    avgMV: +avg(finalRows).toFixed(2),
    nonland: finalRows.map((r) => ({ name: r.v.name, copies: r.copies, cmc: r.v.cmc, seed: seeds.includes(r.v), must: musts.has(r.v.name), interaction: !!r.interaction })),
    lands,
    demand,
    log,
    twins: twinTable,
    stoppedEarly,
    score: +F.toFixed(2),
  };
}

const ENTRY_RANK = { untapped: 0, early: 1, life: 1, late: 2, tapped: 3 };

/** Duals that make only the deck's colors (untapped first, at most half the lands), basics for the rest by pips. */
export function manaBase(L, colors, demand, landPool = [], { landfall = false } = {}) {
  const out = [];
  let left = L;
  const add = (name, k) => {
    k = Math.min(k, left);
    if (k > 0) out.push({ name, copies: k }), (left -= k);
  };
  if (colors.length >= 2) {
    const deck = new Set(colors);
    const duals = landPool
      .filter((c) => !/spend this mana only|can't be countered|choose a creature type/i.test(c.oracle_text ?? "") && !/\bBasic\b/.test(c.type_line ?? ""))
      .map((c) => ({ c, made: (c.produced_mana ?? []).filter((x) => "WUBRG".includes(x)) }))
      .filter(({ c, made }) => !isFetchLand(c) && made.length >= 2 && made.every((x) => deck.has(x)))
      .map(({ c, made }) => ({ c, made, entry: ENTRY_RANK[landEntry(c.oracle_text)] ?? 3 }))
      .sort((a, b) => b.made.length - a.made.length || a.entry - b.entry || a.c.name.localeCompare(b.c.name));
    let dualBudget = Math.floor(L / 2);
    // one or two duals per color pair, best first
    const pairs = new Map();
    for (const d of duals) {
      const key = d.made.slice().sort().join("");
      if ((pairs.get(key) ?? 0) >= 2 || dualBudget <= 0) continue;
      const k = Math.min(4, dualBudget);
      add(d.c.name, k);
      dualBudget -= k;
      pairs.set(key, (pairs.get(key) ?? 0) + 1);
    }
  }
  if (landfall) {
    const fetch = landPool.filter((c) => isFetchLand(c)).sort((a, b) => a.name.localeCompare(b.name))[0];
    if (fetch) add(fetch.name, 4);
  }
  // basics by colored pips (each color used gets at least one)
  const total = colors.reduce((s, c) => s + demand[c], 0) || 1;
  const want = colors.map((c) => ({ c, n: Math.max(1, Math.round((left * demand[c]) / total)) }));
  let sum = want.reduce((s, w) => s + w.n, 0);
  while (sum > left) (want.sort((a, b) => b.n - a.n)[0].n -= 1), sum--;
  while (sum < left) (want.sort((a, b) => demand[b.c] - demand[a.c])[0].n += 1), sum++;
  for (const w of want) if (w.n > 0) out.push({ name: BASIC[w.c], copies: w.n });
  if (!colors.length) out.push({ name: "Wastes", copies: left });
  return out;
}

/**
 * Step 7: goldfish refinement (the user's option b, automated). Each round, the best role
 * candidates try each of the weakest non-seed cards' places on the same shuffles; the best swap
 * is kept only if it's faster by more than two standard errors. Seeds and interaction stay.
 */
export function refineByGoldfish({ main, cards, pool, keep = [], rounds = 4, games = 1000, candidatesPerRound = 10, membersPerRound = 4 }) {
  const steps = [];
  let text = main;
  const fixed = new Set(keep);
  const tried = new Set();
  for (let round = 1; round <= rounds; round++) {
    const roles = deckRoles(text, cards, pool, { perRole: 6 });
    const worth = new Map();
    for (const l of roles.layers) for (const m of [...l.producers, ...l.payoffs]) worth.set(m.name, Math.max(worth.get(m.name) ?? -Infinity, m.worth));
    const members = roles.nonland.filter((n) => !fixed.has(n)).sort((a, b) => (worth.get(a) ?? 0) - (worth.get(b) ?? 0)).slice(0, membersPerRound);
    const cands = [];
    for (const l of roles.layers.filter((l) => l.F > 0).slice(0, 5))
      for (const side of ["P", "Q"]) for (const c of l.candidates[side].slice(0, 3)) if (!cands.includes(c.name) && !tried.has(c.name)) cands.push(c.name);
    const candidates = cands.slice(0, candidatesPerRound);
    if (!members.length || !candidates.length) break;
    const r = compareSwaps(text, cards, { candidates, members, games, seed0: 1 + round * 100003 });
    const best = r.results[0];
    for (const c of candidates) tried.add(c);
    if (!best || !(best.delta < -2 * best.se) || best.delta > -0.03) {
      steps.push({ round, kept: false, base: r.base.mean, best });
      break;
    }
    text = applySwaps(text, [{ out: best.out, in: best.in }]).text;
    tried.delete(best.out); // a card swapped out may come back later
    steps.push({ round, kept: true, base: r.base.mean, ...best });
  }
  return { main: text, steps };
}

/**
 * Cohesion on the role graph the deck was built from: two cards are linked when one makes what the
 * other uses, in a role whose rare side (payoffs; producers for a reversed role) is ≤ 5% of Standard, so "any creature with an enter
 * trigger" doesn't link everything. Interaction cards are left out; they're outside the graph by design.
 */
export function roleCohesion(names, pool) {
  const byName = new Map(pool.map((c) => [short(c.name), c]));
  const share = payoffShare(pool);
  const vs = names.map((n) => byName.get(n)).filter(Boolean).map((c) => view(c));
  const R = new Map(vs.map((v) => [v.name, rolesOf(v)]));
  const edges = [];
  for (const [id] of RULES) {
    if ((REVERSED.has(id) ? share.P[id] : share.Q[id]) > INCIDENTAL) continue; // the rare side decides
    const P = vs.filter((v) => R.get(v.name).some((r) => r.id === id && r.side === "P"));
    const Q = vs.filter((v) => R.get(v.name).some((r) => r.id === id && r.side === "Q"));
    for (const p of P) for (const q of Q) if (p !== q) edges.push({ a: p.name, b: q.name, id });
  }
  const ns = vs.map((v) => v.name);
  const adj = _internal.adjacency(ns, edges);
  const comps = components(ns, adj);
  return { pieces: comps.length, groups: comps, cuts: cutVertices(ns, adj), lambda2: +algebraicConnectivity(ns, adj).toFixed(2), links: new Set(edges.map((e) => [e.a, e.b].sort().join("|"))).size, isolated: ns.filter((n) => adj.get(n).size === 0) };
}

/** The whole process, seeds → 60 cards: build, refine with the goldfish, then measure. */
export function runSeedBuild({ seeds, pool, landPool = [], colors, needs, removal = 4, twins = 0, refine = true, games = 2000 }) {
  const built = buildFromSeeds({ seeds, pool, landPool, colors, needs, removal, twins });
  if (built.error) return built;
  const cards = [...pool, ...landPool];
  const keep = built.nonland.filter((x) => x.seed || x.must || x.interaction).map((x) => x.name);
  const refined = refine ? refineByGoldfish({ main: built.main, cards, pool, keep }) : { main: built.main, steps: [] };
  const fish = (text) => summary(killTurns(buildDeck(text, cards), { games, seed0: 7 }));
  const interaction = new Set(built.nonland.filter((x) => x.interaction).map((x) => x.name));
  const nonlandNames = (text) => parseList(text).cards.map((c) => c.name).filter((n) => !BASIC_NAMES.has(n) && pool.some((p) => short(p.name) === n));
  const roles = deckRoles(refined.main, cards, pool, { perRole: 6 });
  return {
    ...built,
    built: built.main,
    main: refined.main,
    refineSteps: refined.steps,
    goldfish: { built: fish(built.main), final: refined.steps.some((s) => s.kept) ? fish(refined.main) : null },
    cohesion: roleCohesion(nonlandNames(refined.main).filter((n) => !interaction.has(n)), pool),
    roles: roles.layers.filter((l) => l.F > 0).slice(0, 6).map((l) => ({ id: l.id, name: l.name, producers: l.producerCopies, payoffs: l.payoffCopies, both: l.bothCopies, best: l.split, verdict: l.verdict, base: l.base })),
  };
}
