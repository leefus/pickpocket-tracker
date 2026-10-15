/**
 * Synergy graph for a deck. Pure, so it runs under `node --test`.
 *
 * Vertices are the distinct nonland cards in the main deck. Edges come from
 * the deck's "Synergy Edges" text, one per line:
 *
 *   Card A -- Card B | why they work together      (synergy)
 *   Card A !! Card B | why they work against each other   (conflict)
 *
 * Conflicts are kept out of the synergy graph and reported separately, the
 * same split as the interference graph in Steps 4–6 of the project.
 *
 * Measures (same names as the project's Step 8 write-up):
 *   isolated     cards with no synergy edge: filler, first to question
 *   components   1 means one engine; more means separate plans
 *   cut vertices cards whose loss disconnects the engine (single points of failure)
 *   λ₂           algebraic connectivity (Fiedler value) of the Laplacian; 0 iff disconnected
 *   live by Tn   expected number of synergy edges with both cards seen by turn n
 */
import { BASIC_LANDS, parseList } from "./decklist.mjs";
import standardLands from "./standard-lands.mjs";

const LANDS = new Set([...BASIC_LANDS, ...standardLands]);
export const isLand = (name) => LANDS.has(name);

/** Vertices with their copy counts. */
export function deckVertices(mainText) {
  return parseList(mainText)
    .cards.filter((c) => !isLand(c.name))
    .map((c) => ({ name: c.name, copies: c.qty }));
}

/** Parse the edge list. Unknown card names are reported, not fatal. */
export function parseEdges(text, vertexNames) {
  const known = new Set(vertexNames);
  const lower = new Map(vertexNames.map((n) => [n.toLowerCase(), n]));
  const resolve = (s) => lower.get(s.trim().toLowerCase()) ?? null;
  const edges = [];
  const conflicts = [];
  const problems = [];
  const seen = new Set();
  String(text ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .forEach((line, i) => {
      if (!line || line.startsWith("#") || line.startsWith("//")) return;
      const [pair, ...why] = line.split("|");
      const reason = why.join("|").trim();
      const m = pair.match(/^(.+?)\s*(--|!!)\s*(.+)$/);
      if (!m) {
        problems.push(`Line ${i + 1} needs "Card A -- Card B" or "Card A !! Card B": ${line}`);
        return;
      }
      const a = resolve(m[1]);
      const b = resolve(m[3]);
      const missing = [[m[1], a], [m[3], b]].filter(([, r]) => !r).map(([s]) => s.trim());
      if (missing.length) {
        problems.push(`Line ${i + 1}: not a nonland card in the main deck: ${missing.join(", ")}`);
        return;
      }
      if (a === b) return; // self-loops say nothing about connectivity
      const key = [m[2], ...[a, b].sort()].join("\u0000");
      if (seen.has(key)) return;
      seen.add(key);
      (m[2] === "--" ? edges : conflicts).push({ a, b, reason });
    });
  return { edges, conflicts, problems, known };
}

/* ------------------------------------------------------------- hypergeometric */

const lnFact = (() => {
  const t = [0];
  for (let i = 1; i <= 200; i++) t[i] = t[i - 1] + Math.log(i);
  return (n) => t[n];
})();
const lnC = (n, k) => (k < 0 || k > n ? -Infinity : lnFact(n) - lnFact(k) - lnFact(n - k));
const C = (n, k) => (k < 0 || k > n ? 0 : Math.exp(lnC(n, k) - lnC(n, 0)));
const ratio = (n1, k, n0) => Math.exp(lnC(n1, k) - lnC(n0, k)); // C(n1,k)/C(n0,k)

/** P(at least one of `copies` in `seen` cards from a `size`-card deck). */
export const pSeen = (copies, seen, size = 60) => 1 - ratio(size - copies, seen, size);

/** P(at least one of each of two disjoint groups), by inclusion–exclusion. */
export const pBoth = (a, b, seen, size = 60) =>
  1 - ratio(size - a, seen, size) - ratio(size - b, seen, size) + ratio(size - a - b, seen, size);

/* ------------------------------------------------------------------- structure */

function adjacency(names, edges) {
  const adj = new Map(names.map((n) => [n, new Set()]));
  for (const { a, b } of edges) {
    adj.get(a).add(b);
    adj.get(b).add(a);
  }
  return adj;
}

export function components(names, adj) {
  const seen = new Set();
  const out = [];
  for (const s of names) {
    if (seen.has(s)) continue;
    const comp = [];
    const stack = [s];
    seen.add(s);
    while (stack.length) {
      const v = stack.pop();
      comp.push(v);
      for (const w of adj.get(v)) if (!seen.has(w)) (seen.add(w), stack.push(w));
    }
    out.push(comp);
  }
  return out.sort((x, y) => y.length - x.length);
}

/** Tarjan's articulation points (iterative-safe at deck sizes; recursion depth ≤ #cards). */
export function cutVertices(names, adj) {
  const disc = new Map();
  const low = new Map();
  const cut = new Set();
  let t = 0;
  const dfs = (v, parent) => {
    disc.set(v, t);
    low.set(v, t);
    t++;
    let children = 0;
    for (const w of adj.get(v)) {
      if (!disc.has(w)) {
        children++;
        dfs(w, v);
        low.set(v, Math.min(low.get(v), low.get(w)));
        if (parent !== null && low.get(w) >= disc.get(v)) cut.add(v);
      } else if (w !== parent) {
        low.set(v, Math.min(low.get(v), disc.get(w)));
      }
    }
    if (parent === null && children > 1) cut.add(v);
  };
  for (const v of names) if (!disc.has(v)) dfs(v, null);
  return names.filter((n) => cut.has(n));
}

/** For a cut vertex: the cards that lose all connection to the main engine without it. */
export function strandedBy(v, names, adj) {
  // Only v's own component matters; cards that were never connected aren't "stranded" by v.
  const home = components(names, adj).find((c) => c.includes(v)).filter((n) => n !== v);
  const without = new Map(home.map((k) => [k, new Set([...adj.get(k)].filter((x) => x !== v))]));
  const parts = components(home, without); // sorted largest first: the largest part is the engine that survives
  return parts.slice(1).flat().sort();
}

/** Eigenvalues of a small symmetric matrix (cyclic Jacobi). */
export function symmetricEigenvalues(M) {
  const n = M.length;
  const A = M.map((r) => r.slice());
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += A[p][q] ** 2;
    if (off < 1e-20) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(A[p][q]) < 1e-15) continue;
        const theta = (A[q][q] - A[p][p]) / (2 * A[p][q]);
        const tt = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(tt * tt + 1);
        const s = tt * c;
        for (let k = 0; k < n; k++) {
          const akp = A[k][p];
          const akq = A[k][q];
          A[k][p] = c * akp - s * akq;
          A[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = A[p][k];
          const aqk = A[q][k];
          A[p][k] = c * apk - s * aqk;
          A[q][k] = s * apk + c * aqk;
        }
      }
    }
  }
  return A.map((r, i) => r[i]).sort((x, y) => x - y);
}

/** λ₂ of the graph Laplacian L = D − A. */
export function algebraicConnectivity(names, adj) {
  if (names.length < 2) return 0;
  const idx = new Map(names.map((n, i) => [n, i]));
  const L = names.map(() => names.map(() => 0));
  for (const v of names) {
    const i = idx.get(v);
    L[i][i] = adj.get(v).size;
    for (const w of adj.get(v)) L[i][idx.get(w)] = -1;
  }
  const ev = symmetricEigenvalues(L);
  return Math.max(0, ev[1]);
}

/**
 * Everything the tracker shows about one deck's graph.
 * `deadCounts` maps card name → times flagged dead (from the match log).
 * Turn n on the play has seen 6 + n cards (7 in the opener, a draw from turn 2).
 */
export function analyzeDeck(mainText, edgesText, { deadCounts = new Map(), turns = [4, 7], deckSize } = {}) {
  const vertices = deckVertices(mainText);
  const names = vertices.map((v) => v.name);
  const copies = new Map(vertices.map((v) => [v.name, v.copies]));
  const size = deckSize ?? parseList(mainText).count ?? 60;
  const { edges, conflicts, problems } = parseEdges(edgesText, names);
  const adj = adjacency(names, edges);
  const comps = components(names, adj);
  const cuts = cutVertices(names, adj);
  const lambda2 = algebraicConnectivity(names, adj);

  const live = Object.fromEntries(
    turns.map((t) => [t, edges.reduce((s, e) => s + pBoth(copies.get(e.a), copies.get(e.b), 6 + t, size), 0)]),
  );

  const maxDeg = Math.max(0, ...names.map((n) => adj.get(n).size));
  const cards = vertices
    .map(({ name, copies: k }) => {
      const degree = adj.get(name).size;
      const isCut = cuts.includes(name);
      return {
        name,
        copies: k,
        degree,
        neighbors: [...adj.get(name)].sort(),
        hub: degree > 0 && degree === maxDeg,
        isolated: degree === 0,
        cut: isCut,
        stranded: isCut ? strandedBy(name, names, adj) : [],
        pT4: pSeen(k, 10, size),
        dead: deadCounts.get(name) ?? 0,
        conflicts: conflicts.filter((c) => c.a === name || c.b === name).map((c) => (c.a === name ? c.b : c.a)),
      };
    })
    .sort((x, y) => y.degree - x.degree || x.name.localeCompare(y.name));

  // A cut vertex with few copies is the deck's most fragile point.
  const fragile = cards.filter((c) => c.cut && c.copies <= 2);

  return {
    vertexCount: names.length,
    edgeCount: edges.length,
    density: names.length > 1 ? (2 * edges.length) / (names.length * (names.length - 1)) : 0,
    components: comps,
    isolated: cards.filter((c) => c.isolated).map((c) => c.name),
    cuts,
    fragile: fragile.map((c) => c.name),
    lambda2,
    live,
    edges,
    conflicts,
    problems,
    cards,
  };
}

/**
 * Short display label: the part before the comma, unless several cards share
 * it (three Tinybones), then the part after it.
 */
export function shortLabels(names) {
  const prefix = (n) => (n.includes(",") ? n.split(",")[0].trim() : n);
  const counts = new Map();
  for (const n of names) counts.set(prefix(n), (counts.get(prefix(n)) ?? 0) + 1);
  return new Map(
    names.map((n) => {
      let label = prefix(n);
      if (counts.get(label) > 1) label = n.includes(",") ? n.split(",").slice(1).join(",").trim().replace(/^the /i, "") : n;
      if (label.length > 15) label = `${label.slice(0, 14)}…`;
      return [n, label];
    }),
  );
}

// Exported for tests.
export const _internal = { C, ratio, adjacency };
