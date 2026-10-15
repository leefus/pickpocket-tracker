/**
 * Plan profile: what each card does for me and against the opponent, on seven
 * axes, read from card text. Pure, so it runs under `node --test`.
 *
 * Win axes end the game and are measured as a share of a kill:
 *   life (20), poison (10), mill (the opponent's library, ~53 at the start), instant win.
 * Resource axes help you get there and stay in their own units:
 *   cards, board, tempo.
 *
 * A card's swing on an axis = what I gain + what they lose − what it costs me.
 * A cost the deck pays off (discard into Pocket Nuisance, sacrifice into a
 * sacrifice payoff) counts as fuel, not as a cost.
 *
 * ASSUMPTIONS (stated on the page): 1 card or 1 creature's worth of board ≈ 10%
 * of a kill; 1 tempo ≈ 5%. These turn resource effects into kill-equivalents
 * only for the self-harm ratio; the profile itself keeps them separate.
 */
import { parseList } from "./decklist.mjs";
import { indexCards } from "./pretest.mjs";

export const WIN_AXES = [
  { id: "life", label: "Life", lethal: 20 },
  { id: "poison", label: "Poison", lethal: 10 },
  { id: "mill", label: "Mill", lethal: 53 },
  { id: "win", label: "Instant win", lethal: 1 },
];
export const RESOURCE_AXES = [
  { id: "cards", label: "Cards" },
  { id: "board", label: "Board" },
  { id: "tempo", label: "Tempo" },
];
export const KILL_EQUIV = { cards: 0.1, board: 0.1, tempo: 0.05 };
const AXES = [...WIN_AXES, ...RESOURCE_AXES].map((a) => a.id);

const NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, x: 1, that: 1 };
const n = (w) => (/^\d+$/.test(w) ? Number(w) : NUM[String(w).toLowerCase()] ?? 1);

const textOf = (card) => [card.oracle_text, ...(card.card_faces ?? []).map((f) => f.oracle_text)].filter(Boolean).join("\n").replace(/\([^)]*\)/g, "");
const typeOf = (card) => card.card_faces?.[0]?.type_line ?? card.type_line ?? "";
const powerOf = (card) => Number(card.power ?? card.card_faces?.find((f) => f.power != null)?.power ?? 0) || 0;

const empty = () => Object.fromEntries(AXES.map((a) => [a, { mine: 0, theirs: 0, cost: 0 }]));

/**
 * Score one card. Returns { axes: {id: {mine, theirs, cost}}, costs: [{axis, amount, optional, kind}], notes: [] }.
 * Every pattern is deliberately simple; Claude's review corrects the odd miss.
 */
export function scoreCard(card) {
  const t = textOf(card);
  const ty = typeOf(card);
  const s = empty();
  const costs = [];
  const add = (axis, side, v) => (s[axis][side] += v);
  const isCreature = /\bCreature\b/.test(ty) && !/\bLand\b/.test(ty);
  const evasive = /(^|\n)(Flash\n)?(Flying|Menace|Trample)\b|can't be blocked/i.test(t);

  /* life */
  if (isCreature) add("life", "theirs", powerOf(card) * (evasive ? 1.5 : 1)); // one hit's worth of pressure
  for (const [, k] of t.matchAll(/(?:each|target) opponents? loses? (\w+) life/gi)) add("life", "theirs", n(k));
  for (const [, k] of t.matchAll(/deals (\w+) damage to (?:each opponent|target opponent|target player|that player)/gi)) add("life", "theirs", n(k));
  for (const [, k] of t.matchAll(/deals (\w+) damage to any target/gi)) {
    add("life", "theirs", n(k) / 2); // burn that can go face or kill a creature: half each
    add("board", "theirs", 0.5);
  }
  for (const [, k] of t.matchAll(/(?:any number of target players each|target players? each) (?:mill a card and )?lose (\w+) life/gi)) add("life", "theirs", n(k));
  for (const [, k] of t.matchAll(/\byou gain (\w+) life/gi)) add("life", "mine", n(k));
  if (/\blifelink\b/i.test(t) && isCreature) add("life", "mine", powerOf(card));
  for (const [, k] of t.matchAll(/\byou lose (\w+) life/gi)) costs.push({ axis: "life", amount: n(k), optional: false, kind: "life" });
  for (const m of t.matchAll(/(discard a card or )?pay (\w+) life/gi)) costs.push({ axis: "life", amount: n(m[2]), optional: Boolean(m[1]) || /\bmay pay\b/i.test(t), kind: "life", group: m[1] ? "discard-or-life" : undefined });
  for (const [, k] of t.matchAll(/deals (\w+) damage to you\b/gi)) costs.push({ axis: "life", amount: n(k), optional: false, kind: "life" });

  /* poison, mill, instant win */
  for (const [, k] of t.matchAll(/\btoxic (\d+)/gi)) add("poison", "theirs", n(k));
  if (/\binfect\b/i.test(t) && isCreature) add("poison", "theirs", powerOf(card));
  for (const [, k] of t.matchAll(/gets? (\w+) poison counters?/gi)) add("poison", "theirs", n(k));
  if (/\bproliferate\b/i.test(t)) add("poison", "theirs", 1);
  for (const [, k] of t.matchAll(/(?:target player|target opponent|each opponent|any number of target players each|target players each) mills? (\w+) cards?/gi)) add("mill", "theirs", n(k));
  if (/you win the game|loses the game/i.test(t)) add("win", "theirs", 1);

  /* cards */
  for (const [, k] of t.matchAll(/\bdraws? (\w+) cards?/gi)) add("cards", "mine", n(k));
  if (/\binvestigate\b|create[^.]*\bClue\b/i.test(t)) add("cards", "mine", 1);
  if (/\b(scry|surveil) \d/i.test(t)) add("cards", "mine", 0.25);
  if (/search your library for an? (?!basic land)[^.]*card[^.]*(hand|graveyard)/i.test(t)) add("cards", "mine", 1);
  for (const [, k] of t.matchAll(/(?:each opponent|target opponent|any number of target players each) discards? (\w+) cards?/gi)) add("cards", "theirs", n(k));
  if (/you may cast[^.]*(that player's graveyard|exiled (nonland )?card)|play the exiled card/i.test(t)) add("cards", "mine", 1);
  for (const m of t.matchAll(/(?:as an additional cost[^.]*)?\bdiscard (a card|your hand|two cards)/gi)) {
    if (/each|target/i.test(t.slice(Math.max(0, m.index - 30), m.index))) continue; // the opponent discards, handled above
    if (/discard your hand, then draw/i.test(t)) continue; // a rummage, roughly card-neutral
    const alt = /discard a card or pay/i.test(t);
    costs.push({ axis: "cards", amount: m[1] === "two cards" ? 2 : 1, optional: alt, kind: "discard", group: alt ? "discard-or-life" : undefined });
  }

  /* board */
  if (isCreature) add("board", "mine", 1);
  for (const [, k] of t.matchAll(/create (\w+)[^.]*?creature tokens?/gi)) add("board", "mine", n(k));
  if (/destroy (up to one |another )?(other )?target (creature|planeswalker|nonland permanent|permanent|artifact|enchantment)|exile target (creature|nonland permanent|permanent)|deals \w+ damage to target creature|each opponent sacrifices|target creature gets -\d/i.test(t)) add("board", "theirs", 1);
  if (/destroy all|exile all|deals \w+ damage to each creature/i.test(t)) add("board", "theirs", 2);
  if (/counter target (spell|creature spell|noncreature spell)|counter target spell/i.test(t)) add("board", "theirs", 1);
  if (/fights? (up to one )?target creature/i.test(t)) add("board", "theirs", 1);
  for (const m of t.matchAll(/(,|:|\bor|you may)\s*sacrifice (another|an?) (creature|artifact|permanent)/gi)) costs.push({ axis: "board", amount: 1, optional: /may|\bor\b/i.test(m[1]), kind: "sacrifice" });

  /* tempo */
  if (/\{T\}: Add \{|Treasure token|play an additional land|costs? \{\d\} less|search your library for a basic land card, put it onto the battlefield/i.test(t)) add("tempo", "mine", 1);
  if (/\bflash\b/i.test(t)) add("tempo", "mine", 0.5);
  if (/tap (up to one )?target creature|stun counter|can't cast spells|can't attack|return target (nonland permanent|creature)[^.]*owner's hand/i.test(t)) add("tempo", "theirs", 1);

  return { axes: s, costs };
}

/** Does the deck pay off this kind of cost? (discard → discard payoffs, sacrifice → sacrifice payoffs, life → "whenever you lose life") */
export function fuelKinds(cards) {
  const all = cards.map(textOf).join("\n");
  const kinds = new Set();
  if (/whenever (a player|an opponent|one or more players|you) discards?/i.test(all)) kinds.add("discard");
  if (/whenever you sacrifice|you('ve)? sacrificed|whenever (a|another) (creature|artifact)s? you control dies/i.test(all)) kinds.add("sacrifice");
  if (/whenever you lose life|life you('ve)? lost/i.test(all)) kinds.add("life");
  return kinds;
}

const swingOf = (a) => a.mine + a.theirs - a.cost;

/**
 * Deck profile.
 * @returns {{cards: {name, qty, axes, costs}[], totals: {id: number}, win: {id, label, kills}[], resources: {id,label,units}[], main, focus, pressure: {life,...}}}
 */
export function profileDeck(mainText, cardData) {
  const idx = indexCards(cardData);
  const rows = parseList(mainText)
    .cards.map((c) => ({ ...c, card: idx.get(c.name.toLowerCase()) }))
    .filter((r) => r.card && !/\bLand\b/.test(typeOf(r.card)));
  const fuel = fuelKinds(rows.map((r) => r.card));
  const cards = rows.map((r) => {
    const sc = scoreCard(r.card);
    for (const c of sc.costs) c.fuel = fuel.has(c.kind);
    // "Discard a card or pay 3 life": when one option is fuel you always pick it, so the other costs nothing.
    for (const c of sc.costs) if (c.group && sc.costs.some((o) => o.group === c.group && o.fuel)) c.fuel = true;
    // A cost the deck pays off is fuel. Alternatives ("discard a card or pay 3 life") count once, at the
    // cheaper option against an average opponent; other optional costs count half (you won't always pay them).
    const seen = new Set();
    for (const c of sc.costs) {
      if (c.fuel) continue;
      if (c.group) {
        if (seen.has(c.group)) continue;
        seen.add(c.group);
        const opts = sc.costs.filter((o) => o.group === c.group);
        const cheapest = opts.reduce((m, o) => (unitCost(o, 0.5) < unitCost(m, 0.5) ? o : m));
        sc.axes[cheapest.axis].cost += cheapest.amount;
        continue;
      }
      sc.axes[c.axis].cost += c.optional ? c.amount / 2 : c.amount;
    }
    return { name: r.name, qty: r.qty, axes: sc.axes, costs: sc.costs };
  });

  const totals = Object.fromEntries(AXES.map((a) => [a, 0]));
  const theirs = Object.fromEntries(AXES.map((a) => [a, 0]));
  for (const c of cards) for (const a of AXES) {
    totals[a] += c.qty * swingOf(c.axes[a]);
    theirs[a] += c.qty * c.axes[a].theirs;
  }
  const win = WIN_AXES.map((a) => ({ ...a, kills: totals[a.id] / a.lethal, pressure: theirs[a.id] / a.lethal }));
  const resources = RESOURCE_AXES.map((a) => ({ ...a, units: totals[a.id] }));
  // Main win axis: the one this deck pushes furthest toward a kill. Instant win counts only if present.
  const ranked = [...win].sort((a, b) => b.kills - a.kills);
  const positive = win.filter((w) => w.kills > 0);
  const sum = positive.reduce((s, w) => s + w.kills, 0);
  return {
    cards,
    totals,
    win,
    resources,
    main: ranked[0]?.kills > 0 ? ranked[0].id : null,
    focus: sum > 0 ? ranked[0].kills / sum : 0,
    fuel: [...fuel],
  };
}

/**
 * Automatic matchup pressure: how hard each opponent pushes each win axis,
 * scaled so the hardest-pushing deck in the field is 1.
 * @param {{name, profile}[]} field
 */
export function pressureTable(field) {
  const out = {};
  for (const a of WIN_AXES) {
    const max = Math.max(0, ...field.map((f) => f.profile.win.find((w) => w.id === a.id).pressure));
    for (const f of field) {
      out[f.name] ??= {};
      out[f.name][a.id] = max > 0 ? f.profile.win.find((w) => w.id === a.id).pressure / max : 0;
    }
  }
  return out;
}

/** Kill-equivalent of what a card does to the opponent (and for me) on resource axes, used to weigh against its self-costs. */
export function benefitOf(card) {
  let b = 0;
  for (const a of WIN_AXES) b += (card.axes[a.id].theirs + (a.id === "life" ? card.axes.life.mine : 0)) / a.lethal;
  for (const a of RESOURCE_AXES) b += (card.axes[a.id].theirs + card.axes[a.id].mine) * KILL_EQUIV[a.id];
  return b;
}

/** Kill-equivalent of paying one cost against an opponent with this life pressure. */
export const unitCost = (c, lifePressure) =>
  c.axis === "life" ? (c.amount / 20) * lifePressure : c.amount * (KILL_EQUIV[c.axis] ?? KILL_EQUIV.board);

/**
 * Self-harm table: every card with a cost the deck doesn't turn into fuel,
 * with its cost against each opponent and a verdict.
 * Life costs scale with that opponent's life pressure; card and board costs use KILL_EQUIV.
 */
export function selfHarm(profile, pressure) {
  const rows = [];
  for (const c of profile.cards) {
    const real = c.costs.filter((x) => !x.fuel);
    if (!real.length) continue;
    const benefit = benefitOf(c);
    const vs = Object.entries(pressure).map(([opp, p]) => {
      let cost = 0;
      let choose = null;
      const groups = new Set();
      for (const x of real) {
        if (x.group) {
          if (groups.has(x.group)) continue;
          groups.add(x.group);
          // A choice of costs: pay whichever is cheaper against THIS opponent.
          const best = real.filter((o) => o.group === x.group).reduce((m, o) => (unitCost(o, p.life) < unitCost(m, p.life) ? o : m));
          cost += unitCost(best, p.life);
          choose = best.kind;
          continue;
        }
        cost += unitCost(x, p.life);
      }
      return { opp, cost, ratio: cost > 0 ? benefit / cost : Infinity, worth: benefit >= cost, choose };
    });
    rows.push({ name: c.name, qty: c.qty, costs: real, benefit, vs });
  }
  return rows;
}
