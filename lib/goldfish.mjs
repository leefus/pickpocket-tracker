/**
 * A generic goldfish: how fast does this 60 kill an opponent who does nothing?
 *
 * Every card is read from its rules text into a small model (power, haste, mana,
 * what it does when it enters, dies or triggers). It is the same convention as the
 * deck-specific simulators in the project: no blockers, no removal, removal with no
 * target is dead, keep 7 unless 0–1 or 6–7 lands (then 6), on the play, colors ignored.
 *
 * Its job is comparing two versions of one deck, not predicting a kill turn:
 * `compareSwaps` plays both versions on the same shuffles (common random numbers),
 * so the difference has far less noise than either number. Pure; runs under node --test.
 */
import { parseList } from "./decklist.mjs";
import { indexCards, landEntry } from "./pretest.mjs";
import { ownText, typeOf } from "./autoedges.mjs";

const WORD = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, x: 1 };
const num = (s) => (s == null ? 0 : /^\d+$/.test(s) ? +s : (WORD[s.toLowerCase()] ?? 1));

/** What a piece of text does, in goldfish terms. */
export function parseEffect(text) {
  // what the opponent gets to do ("Its controller may search…") isn't ours
  const t = String(text ?? "").replace(/(^|\.\s*)(Its|Their) (controller|owner)[^.]*\./g, "$1").replace(/(^|\.\s*)That player[^.]*\./g, "$1");
  const e = { dmg: 0, draw: 0, tokens: [], treasure: 0, junk: 0, counterSelf: 0, counterTarget: 0, gain: 0, ramp: 0, reanimate: 0 };
  for (const m of t.matchAll(/deals? (\d+|x) damage to (each opponent|target opponent|target player|any target|each player|that player|defending player)/gi)) e.dmg += num(m[1]);
  for (const m of t.matchAll(/(?:each|target) opponents? loses? (\d+|x) life/gi)) e.dmg += num(m[1]);
  for (const m of t.matchAll(/\bdraws? (a|an|one|two|three|\d+) cards?/gi)) e.draw += num(m[1]);
  for (const m of t.matchAll(/create (a|an|one|two|three|four|x|\d+) (\d+)\/(\d+)[^.]*?creature tokens?/gi)) for (let i = 0; i < num(m[1]); i++) e.tokens.push(+m[2]);
  for (const m of t.matchAll(/create (a|an|one|two|three|x|\d+) (tapped )?Treasure tokens?/gi)) e.treasure += num(m[1]);
  for (const m of t.matchAll(/create (a|an|one|two|three|x|\d+) (tapped )?(Clue|Food|Map|Lander|Mutagen|Blood|Junk|Incubator)[^.]*?tokens?/gi)) e.junk += num(m[1]);
  for (const m of t.matchAll(/put (a|an|one|two|three|\d+) \+1\/\+1 counters? on (this creature|this|it)\b/gi)) e.counterSelf += num(m[1]);
  for (const m of t.matchAll(/put (a|an|one|two|three|\d+) \+1\/\+1 counters? on (target|up to one target|another target|each) creature/gi)) e.counterTarget += num(m[1]);
  for (const m of t.matchAll(/you gain (\d+|x|that much|that many) life/gi)) e.gain += num(m[1]);
  // "that many" / "equal to": filled in from what triggered it
  if (/damage equal to that creature's power/i.test(t)) e.dmgEnteringPower = 1;
  if (/damage equal to the number of Treasures you control/i.test(t)) e.dmgTreasures = 1;
  if (/damage equal to the number of lands you control/i.test(t)) e.dmgLands = 1;
  if (/draw that many cards/i.test(t)) e.drawAmount = 1;
  if (/create that many (tapped )?Treasure/i.test(t)) e.treasureAmount = 1;
  if (/gains control of this/i.test(t)) e.leaves = 1;
  for (const m of t.matchAll(/search your library for (a|an|up to one|up to two|two) basic lands? cards?[^.]*onto the battlefield/gi)) e.ramp += /two/.test(m[1]) ? 2 : 1;
  for (const m of t.matchAll(/return (up to )?(one|two|a|target|\w+) (target )?creature cards?[^.]*from your graveyard to the battlefield/gi)) e.reanimate += num(m[2]) || 1;
  e.any = e.dmgEnteringPower || e.dmgTreasures || e.dmgLands || e.drawAmount || e.treasureAmount || e.dmg || e.draw || e.tokens.length || e.treasure || e.junk || e.counterSelf || e.counterTarget || e.gain || e.ramp || e.reanimate;
  return e;
}

/** Which event a triggered ability listens for. */
function triggerEvent(head) {
  const h = head.toLowerCase();
  if (/^landfall|whenever a land (you control )?enters/.test(h)) return { ev: "land" };
  if (/^when(ever)? this[^,]*\benters\b/.test(h)) return { ev: "etb", alsoAttack: /enters or attacks/.test(h) };
  if (/^when(ever)? this[^,]*\bdies\b/.test(h)) return { ev: "selfdies" };
  if (/whenever (another|a|one or more)( other)? (nontoken )?creatures?( or planeswalkers?)? (you control )?enters?/.test(h)) return { ev: "creature", another: /another|other/.test(h), nontoken: /nontoken/.test(h) };
  const tribe = head.match(/whenever (another|a|one or more)( other)? (nontoken )?([A-Z][a-z]+)s? (you control )?enters?/);
  if (tribe) return { ev: "creature", another: /another|other/i.test(tribe[1] + (tribe[2] ?? "")), nontoken: !!tribe[3], tribe: tribe[4] };
  if (/whenever this[^,]*attacks/.test(h)) return { ev: "selfattack" };
  if (/whenever you attack|whenever one or more creatures you control attack/.test(h)) return { ev: "attack" };
  if (/whenever this[^,]*deals combat damage to (a player|an opponent)/.test(h)) return { ev: "selfconnect" };
  if (/whenever (a|one or more) creatures? you control deals? combat damage to (a player|an opponent)/.test(h)) return { ev: "connect" };
  if (/whenever you cast an? (instant or sorcery|instant|sorcery)/.test(h)) return { ev: "cast", kind: "spell" };
  if (/whenever you cast a noncreature spell/.test(h)) return { ev: "cast", kind: "noncreature" };
  if (/whenever you cast a (creature )?spell/.test(h)) return { ev: "cast", kind: /creature/.test(h) ? "creature" : "any" };
  if (/whenever you sacrifice/.test(h)) return { ev: "sac", what: /artifact/.test(h) ? "artifact" : /creature/.test(h) ? "creature" : /token/.test(h) ? "token" : "any" };
  if (/whenever (a|another|one or more)( other)? (nontoken )?(creature|artifact|token|permanent)s? you control (dies|is put into a graveyard|are put into)/.test(h) || /whenever (a|another) creature dies/.test(h))
    return { ev: "sac", what: /artifact/.test(h) ? "artifact" : "creature" };
  if (/at the beginning of your upkeep/.test(h)) return { ev: "upkeep" };
  if (/at the beginning of (your|each) end step/.test(h)) return { ev: "end" };
  if (/whenever (an opponent|a player) loses life/.test(h)) return { ev: "lifeloss" };
  if (/whenever you gain life/.test(h)) return { ev: "lifegain" };
  if (/whenever you draw your second card/.test(h)) return { ev: "draw2" };
  return null;
}

/** The goldfish model of one card. */
export function compile(input) {
  // A double-faced card is played as its front face (its back face's text isn't there yet).
  const f0 = input.card_faces?.[0];
  const card = f0 && !input.oracle_text && /transform|modal_dfc|adventure|flip/.test(input.layout ?? "transform")
    ? { ...input, name: input.name, oracle_text: f0.oracle_text, type_line: f0.type_line, power: f0.power ?? input.power, card_faces: null }
    : input;
  const ty = typeOf(card);
  const front = ty.split(" // ")[0];
  const t = ownText(card);
  const kw = (card.keywords ?? []).map((k) => k.toLowerCase());
  const m = {
    name: card.name.split(" // ")[0],
    land: /\bLand\b/.test(front),
    creature: /\bCreature\b/.test(front),
    spell: /\b(Instant|Sorcery)\b/.test(front),
    cost: Math.max(0, card.cmc ?? 0) + (/^Spree\b/m.test(t) ? 2 : 0),
    power: Number(card.power ?? card.card_faces?.[0]?.power ?? 0) || 0,
    haste: kw.includes("haste") || /(^|\n|, )haste\b/i.test(t),
    lifelink: kw.includes("lifelink"),
    starLands: /power is equal to the number of lands you control/i.test(t),
    dork: false,
    extraLand: /you may play an additional land/i.test(t),
    // which creatures' triggers it doubles: { power: 2 } (Delney), { type: "Ninja" } (Splinter), { legend: true }, or { all: true }
    doubler: (() => {
      if (!/triggers an additional time/i.test(t)) return null;
      if (/creature you control with power 2 or less/i.test(t)) return { power: 2 };
      if (/triggered ability of a legendary creature/i.test(t)) return { legend: true };
      const tribe = t.match(/triggered ability of (?:a|an|another) ([A-Z][a-z]+)(?: creature)? you control triggers/);
      if (tribe) return { type: tribe[1] };
      if (/triggered ability of a permanent you control triggers/i.test(t)) return { all: true };
      return null; // enter-, attack- or equipment-only doublers aren't modeled
    })(),
    legend: /\bLegendary\b/.test(front),
    sacOutlet: false,
    needsSac: /as an additional cost to cast this spell, sacrifice/i.test(t),
    pump: 0,
    entry: landEntry(card.oracle_text ?? ""),
    types: /changeling/i.test(t) || /every creature type/i.test(t) ? ["*"] : (front.split(" — ")[1] ?? "").split(/\s+/).filter(Boolean),
    fetch: /search your library for a basic land card/i.test(t),
    etb: null,
    dies: null,
    triggers: [],
  };
  const statics = [];
  for (const raw of t.split("\n")) {
    const line = raw.replace(/^(Landfall|Raid|Alliance|Revolt|Eerie|Survival|Valiant|Celebration|Descend \d+|Threshold|Max speed) — /, (s, w) => (w === "Landfall" ? "Landfall " : ""));
    const trig = line.match(/^(Landfall [^,]*|When(?:ever)? [^,]+|At the beginning of [^,]+),\s*(.*)$/i);
    if (trig) {
      const ev = triggerEvent(trig[1]);
      if (!ev) continue;
      // A condition the goldfish can't track ("if there are seven or more cards in your graveyard")
      // is treated as not met, rather than as always met: Eye of Jace used to ping every upkeep.
      if (/\bif (there are|you have) (\w+) or more cards in your graveyard/i.test(trig[2])) continue;
      const eff = parseEffect(trig[2]);
      if (/double the power/i.test(trig[2])) eff.doublePower = 1;
      const pump = trig[2].match(/(another )?target creature you control gets \+(\d+)\/\+\d+[^.]*until end of turn/i);
      if (pump) eff.tempPump = +pump[2]; // Foot Elite: the best other attacker hits harder this turn
      if (/sacrifice this/i.test(trig[2])) eff.leaves = 1; // a one-shot that removes itself
      if (!eff.any && !eff.doublePower && !eff.tempPump) continue;
      if (ev.ev === "etb") {
        m.etb = eff;
        if (ev.alsoAttack) m.triggers.push({ ev: "selfattack", eff });
      } else if (ev.ev === "selfdies") m.dies = eff;
      else m.triggers.push({ ...ev, eff });
      continue;
    }
    const act = line.match(/^([^:"]+):\s*(.*)$/);
    if (act && /\{T\}|sacrifice|\{\d\}|\{[WUBRGC]\}/i.test(act[1])) {
      if (/\{T\}/.test(act[1]) && /^Add\b/i.test(act[2]) && !m.land) m.dork = true;
      if (/^sacrifice another (creature|artifact|creature or artifact|artifact or creature|permanent)/i.test(act[1]) && !/\{/.test(act[1])) m.sacOutlet = true;
      continue;
    }
    const pump = line.match(/^(Equipped|Enchanted) creature gets \+(\d+)\//i);
    if (pump) m.pump = +pump[2];
    statics.push(line);
  }
  if (!m.creature && !m.land) {
    // An instant or sorcery does its text when it resolves; other permanents may do things as they enter.
    const body = statics.join("\n");
    const eff = parseEffect(body);
    if (m.spell) m.etb = eff.any ? eff : null;
    else if (!m.etb && eff.any && !/^(Equipped|Enchanted)/m.test(body)) m.etb = eff;
  }
  m.dead = !m.land && !m.creature && !m.etb && !m.pump && !m.triggers.length && !m.dork && !m.extraLand && !m.doubler && !m.sacOutlet;
  return m;
}

export const rng = (seed) => {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
};
const shuffle = (a, r) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/** One game; returns the kill turn (maxTurn + 1 if no kill). `order` is a shuffled array of models. */
export function playGame(order, { maxTurn = 12, r } = {}) {
  let lib = [...order];
  let hand = lib.splice(0, 7);
  const lands = (h) => h.filter((c) => c.land).length;
  if (lands(hand) < 2 || lands(hand) > 5) {
    lib = shuffle([...order], r);
    hand = lib.splice(0, 7);
    const drop = lands(hand) > 3 ? hand.findIndex((c) => c.land) : hand.findIndex((c) => !c.land);
    lib.push(hand.splice(drop, 1)[0]);
  }
  let opp = 20;
  let landsOut = 0, tappedLands = 0, treasures = 0, junk = 0, turn = 0, drawsThisTurn = 0, budget = 0;
  const bf = []; // {m, sick, counters, token}
  const grave = [];
  const doubleFor = (src) => {
    if (!src?.m.creature) return 1;
    const p = src.m.power + (src.counters ?? 0);
    const ok = (d) => d.all || (d.power != null && p <= d.power) || (d.legend && src.m.legend) || (d.type && (src.m.types ?? []).some((x) => x === "*" || x === d.type));
    return bf.some((o) => o.m.doubler && ok(o.m.doubler)) ? 2 : 1;
  };
  const draw = (n) => {
    for (let i = 0; i < n && lib.length; i++) {
      hand.push(lib.shift());
      drawsThisTurn++;
      if (drawsThisTurn === 2) fire("draw2");
    }
  };
  function hurt(n) {
    if (n <= 0) return;
    opp -= n;
    fire("lifeloss");
  }
  function resolve(eff, src, times = 1, ctx = {}) {
    if (!eff || budget-- <= 0) return;
    for (let k = 0; k < times; k++) {
      hurt(eff.dmg);
      if (eff.dmgEnteringPower && ctx.obj) hurt(power(ctx.obj));
      if (eff.dmgTreasures) hurt(treasures);
      if (eff.dmgLands) hurt(landsOut);
      if (eff.drawAmount) draw(ctx.amount ?? 0);
      if (eff.treasureAmount) treasures += ctx.amount ?? 0;
      if (eff.draw) draw(eff.draw);
      for (const p of eff.tokens) enter({ m: { name: "token", creature: true, power: p, triggers: [], types: ctx.tokenTypes ?? [] }, sick: true, counters: 0, token: true });
      treasures += eff.treasure;
      junk += eff.junk;
      if (eff.counterSelf && src) src.counters = (src.counters ?? 0) + eff.counterSelf;
      if (eff.counterTarget) {
        const best = bf.filter((o) => o.m.creature).sort((a, b) => b.m.power + b.counters - (a.m.power + a.counters))[0];
        if (best) best.counters += eff.counterTarget;
      }
      if (eff.tempPump) {
        const best = bf.filter((o) => o.m.creature && !o.sick && o !== src).sort((a, b) => power(b) - power(a))[0];
        if (best) best.temp = (best.temp ?? 0) + eff.tempPump;
      }
      if (eff.doublePower) {
        const best = bf.filter((o) => o.m.creature && !o.sick).sort((a, b) => b.m.power + b.counters - (a.m.power + a.counters))[0];
        if (best) best.temp = (best.temp ?? 0) + Math.max(0, power(best));
      }
      if (eff.gain) fire("lifegain");
      if (eff.leaves && src && bf.includes(src)) bf.splice(bf.indexOf(src), 1);
      for (let i = 0; i < eff.ramp; i++) landEnters(true);
      for (let i = 0; i < eff.reanimate; i++) {
        const gi = grave.reduce((b, c, j) => (b < 0 || c.cost > grave[b].cost ? j : b), -1);
        if (gi >= 0) enter({ m: grave.splice(gi, 1)[0], sick: true, counters: 0 });
      }
    }
  }
  function fire(ev, info = {}) {
    for (const o of [...bf]) {
      for (const tr of o.m.triggers ?? []) {
        if (tr.ev !== ev) continue;
        if (ev === "creature" && tr.another && info.obj === o) continue;
        if (ev === "creature" && tr.nontoken && info.obj?.token) continue;
        if (ev === "creature" && tr.tribe && !(info.obj?.m.types ?? []).some((x) => x === "*" || x === tr.tribe)) continue;
        if (ev === "cast" && !(tr.kind === "any" || tr.kind === info.kind || (tr.kind === "noncreature" && info.kind === "spell"))) continue;
        if (ev === "sac" && tr.what !== "any" && tr.what !== info.what && !(tr.what === "token" && info.token)) continue;
        if ((ev === "selfattack" || ev === "selfconnect") && info.obj !== o) continue;
        resolve(tr.eff, o, doubleFor(o), info);
      }
    }
  }
  function enter(obj) {
    bf.push(obj);
    if (obj.m.etb) resolve(obj.m.etb, obj, doubleFor(obj));
    if (obj.m.creature) fire("creature", { obj });
  }
  function landEnters(tapped) {
    landsOut++;
    if (tapped) tappedLands++;
    fire("land");
  }
  const power = (o) => (o.m.starLands ? landsOut : o.m.power) + (o.counters ?? 0) + (o.temp ?? 0);
  function sacrifice(o, what) {
    if (what === "creature") {
      const at = o ? bf.indexOf(o) : -1;
      if (at < 0) return; // it already left (another effect used it)
      bf.splice(at, 1);
      if (!o.token) grave.push(o.m);
      fire("sac", { what: "creature", token: o.token });
      if (o.m.dies) resolve(o.m.dies, o, doubleFor(o));
    } else fire("sac", { what: "artifact", token: true });
  }

  for (turn = 1; turn <= maxTurn; turn++) {
    budget = 400;
    drawsThisTurn = 0;
    for (const o of bf) (o.sick = false), (o.temp = 0);
    tappedLands = 0;
    fire("upkeep");
    if (turn > 1) draw(1);
    let drops = bf.some((o) => o.m.extraLand) ? 2 : 1;
    while (drops-- > 0) {
      const li = hand.findIndex((c) => c.land);
      if (li < 0) break;
      const L = hand.splice(li, 1)[0];
      const tapped = L.entry === "tapped" || (L.entry === "late" && landsOut < 2) || (L.entry === "early" && landsOut >= 3);
      landEnters(tapped);
      if (L.fetch) fire("land"); // the fetched basic is a second land entering
    }
    let mana = landsOut - tappedLands + bf.filter((o) => o.m.dork && !(o.sick && o.m.creature)).length;
    const pay = (n) => {
      const u = Math.min(mana, n);
      mana -= u;
      treasures -= n - u;
      if (n - u > 0) for (let i = 0; i < n - u; i++) sacrifice(null, "artifact");
    };
    const fodder = () => bf.find((o) => o.token && o.m.creature) ?? bf.find((o) => o.m.creature && o.m.dies && power(o) <= 1);
    const castPhase = () => {
      for (;;) {
        const opts = hand
          .map((c, i) => ({ c, i }))
          .filter(({ c }) => !c.land && !c.dead && c.cost <= mana + treasures && (!c.needsSac || junk > 0 || fodder()))
          .filter(({ c }) => !(c.pump && !bf.some((o) => o.m.creature)))
          .sort((a, b) => b.c.cost - a.c.cost || (b.c.creature ? 1 : 0) - (a.c.creature ? 1 : 0));
        if (!opts.length) return;
        const { c, i } = opts[0];
        hand.splice(i, 1);
        pay(c.cost);
        if (c.needsSac) {
          if (junk > 0) junk--, sacrifice(null, "artifact");
          else sacrifice(fodder(), "creature");
        }
        fire("cast", { kind: c.spell ? "spell" : c.creature ? "creature" : "noncreature" });
        if (c.spell) {
          resolve(c.etb, null);
        } else if (c.pump && !c.creature) {
          const best = bf.filter((o) => o.m.creature).sort((a, b) => power(b) - power(a))[0];
          if (best) best.counters += c.pump;
          bf.push({ m: { ...c, etb: null }, sick: false, counters: 0 });
          if (c.etb) resolve(c.etb, null);
        } else enter({ m: c, sick: !c.haste, counters: 0 });
        if (opp <= 0) return;
      }
    };
    castPhase();
    if (opp <= 0) return turn;
    // combat: everything that can attack does
    const attackers = bf.filter((o) => o.m.creature && !o.sick && power(o) > 0);
    if (attackers.length) fire("attack");
    for (const o of attackers) fire("selfattack", { obj: o });
    for (const o of attackers) {
      const dealt = power(o);
      hurt(dealt);
      if (o.m.lifelink) fire("lifegain");
      fire("selfconnect", { obj: o, amount: dealt });
      fire("connect");
      if (opp <= 0) return turn;
    }
    if (opp <= 0) return turn;
    // second main: spend what's left, then feed any free sacrifice outlet
    castPhase();
    if (opp <= 0) return turn;
    if (bf.some((o) => o.m.sacOutlet)) {
      while (junk > 0 && budget > 0) junk--, sacrifice(null, "artifact");
      for (let f = fodder(); f && budget > 0; f = fodder()) sacrifice(f, "creature");
    }
    fire("end");
    if (opp <= 0) return turn;
  }
  return maxTurn + 1;
}

/** Deck as an array of card models, in list order. Unknown cards count as lands only if named like one. */
export function buildDeck(mainText, cards) {
  const idx = indexCards(cards);
  const models = new Map();
  const out = [];
  for (const { qty, name } of parseList(mainText).cards) {
    const card = idx.get(name.toLowerCase());
    if (!models.has(name)) models.set(name, card ? compile(card) : { name, land: true, entry: "untapped" });
    for (let i = 0; i < qty; i++) out.push(models.get(name));
  }
  return out;
}

/** Kill turns for `games` games, game i always using seed (seed0 + i). */
export function killTurns(deck, { games = 1500, seed0 = 1, maxTurn = 12 } = {}) {
  const out = new Array(games);
  for (let g = 0; g < games; g++) {
    const r = rng(seed0 + g * 7919);
    out[g] = playGame(shuffle([...deck], r), { maxTurn, r });
  }
  return out;
}

export function summary(k, maxTurn = 12) {
  const n = k.length;
  const mean = k.reduce((a, b) => a + b, 0) / n;
  const by = (t) => k.filter((x) => x <= t).length / n;
  return { mean: +mean.toFixed(2), byT5: +by(5).toFixed(3), byT6: +by(6).toFixed(3), byT7: +by(7).toFixed(3), noKill: +(k.filter((x) => x > maxTurn).length / n).toFixed(3) };
}

/** Paired difference (b − a) of two runs on the same seeds: mean and standard error. */
export function paired(a, b) {
  const d = a.map((x, i) => b[i] - x);
  const n = d.length;
  const mean = d.reduce((s, x) => s + x, 0) / n;
  const sd = Math.sqrt(d.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, n - 1));
  return { delta: +mean.toFixed(3), se: +(sd / Math.sqrt(n)).toFixed(3) };
}

/**
 * Try each candidate in place of each member (same copies, same shuffles) and keep each
 * candidate's best swap. Negative delta = faster kill.
 */
export function compareSwaps(mainText, cards, { candidates, members, games = 1500, seed0 = 1 }) {
  const base = buildDeck(mainText, cards);
  const kBase = killTurns(base, { games, seed0 });
  const idx = indexCards(cards);
  const results = [];
  for (const cand of candidates) {
    const card = idx.get(cand.toLowerCase());
    if (!card) continue;
    const model = compile(card);
    let best = null;
    for (const out of members) {
      if (!base.some((m) => m.name === out)) continue;
      const swapped = base.map((m) => (m.name === out ? model : m)); // same positions, so the same shuffles
      const p = paired(kBase, killTurns(swapped, { games, seed0 }));
      if (!best || p.delta < best.delta) best = { in: cand, out, ...p };
    }
    if (best) results.push({ ...best, dead: model.dead });
  }
  results.sort((a, b) => a.delta - b.delta);
  return { base: summary(kBase), games, results };
}
