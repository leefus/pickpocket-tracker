/**
 * Two-player sim: deck A against deck B, both played by the same rule-based player.
 *
 * Cards are read with the goldfish's models (lib/goldfish.mjs compile) plus combat keywords and
 * interaction (parseRemoval). What it plays out that the goldfish can't:
 *   - blocking, trades, deathtouch, first/double strike, trample, flying/reach, menace, lifelink;
 *   - removal, burn, -N/-N, bites, fights and edicts, with simple conditions (mana value, power, tapped);
 *   - death triggers on both sides ("whenever a creature you control with deathtouch dies" → edict).
 * Decisions:
 *   - Attacks are chosen by minimax: every attack set is scored against the defender's best block
 *     (searched exactly when the board is small, greedily otherwise), with a crack-back check.
 *   - Removal goes at the most valuable legal target; burn goes face when no target is worth it.
 *   - Everything happens at sorcery speed: no instant-speed tricks, counterspells or bluffs.
 * Games alternate who is on the play, and game i always uses the same shuffles (seed i), so two
 * versions of a deck are compared on identical games. Pure; runs under node --test.
 */
import { parseList } from "./decklist.mjs";
import { indexCards } from "./pretest.mjs";
import { compile, rng } from "./goldfish.mjs";

const shuffle = (a, r) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/** Card model for the duel: the goldfish model plus combat stats. */
export function duelModel(card) {
  const m = compile(card);
  const f0 = card.card_faces?.[0];
  const text = String(card.oracle_text ?? f0?.oracle_text ?? "");
  const kw = new Set([...(card.keywords ?? [])].map((k) => k.toLowerCase()));
  const has = (k) => kw.has(k) || new RegExp(`(^|\\n)([A-Za-z ]+, )*${k}\\b`, "i").test(text);
  m.toughness = Number(card.toughness ?? f0?.toughness ?? 0) || 0;
  m.flying = has("flying");
  m.reach = has("reach");
  m.deathtouch = has("deathtouch");
  m.firstStrike = has("first strike");
  m.doubleStrike = has("double strike");
  m.trample = has("trample");
  m.menace = has("menace");
  m.vigilance = has("vigilance");
  m.lifelink = m.lifelink || has("lifelink");
  m.defender = has("defender");
  m.cantBlock = /this creature can't block|can't block\./i.test(text);
  m.unblockable = /this creature can't be blocked\b(?! by)/i.test(text);
  m.hexproof = has("hexproof");
  m.indestructible = has("indestructible");
  m.value = m.creature ? Math.max(m.cost, (m.power + m.toughness) / 2) + (m.deathtouch || m.flying || m.lifelink ? 0.5 : 0) + (m.triggers.length ? 0.5 : 0) : m.cost;
  prepareModel(card, m, text);
  return m;
}

/** Mana value of a cost string: {N} counts N, {X} counts 0, every other symbol 1. */
const manaValue = (cost) => [...String(cost ?? "").matchAll(/\{([^}]+)\}/g)].reduce((n, [, x]) => n + (/^\d+$/.test(x) ? +x : x === "X" ? 0 : 1), 0);

/**
 * Prepared spells (Secrets of Strixhaven): a creature whose back face is an instant or sorcery can be "prepared";
 * while it is, you may cast a copy of that spell, which unprepares it. Modelled: enters prepared, becomes prepared
 * when it attacks or at your upkeep, "target creature becomes prepared" on entering (Biblioplex Tomekeeper),
 * "whenever you cast a prepared spell, copy it" (Codie), and blinking a creature so it enters prepared again (All Aboard).
 */
function prepareModel(card, m, frontText) {
  const faces = card.card_faces;
  if (faces?.length === 2 && /prepared/i.test(faces[0].oracle_text ?? "") && /\b(Instant|Sorcery)\b/.test(faces[1].type_line ?? "")) {
    const bt = String(faces[1].oracle_text ?? "");
    const sp = compile({ name: faces[1].name, mana_cost: faces[1].mana_cost, cmc: manaValue(faces[1].mana_cost), type_line: faces[1].type_line, oracle_text: bt });
    const eff = sp.etb ?? { dmg: 0, draw: 0, tokens: [], treasure: 0, junk: 0, counterSelf: 0, counterTarget: 0, gain: 0, ramp: 0, reanimate: 0 };
    if (/search your library for a card, put that card into your hand/i.test(bt)) eff.draw += 1; // a tutor: count it as the best card
    if (/put two cards from your hand on top of your library/i.test(bt)) eff.draw = Math.max(0, eff.draw - 2); // Brainstorm nets one
    if (/exile target non-?\w* ?creature you control, then return that card to the battlefield/i.test(bt)) sp.flicker = /non-Pilot/i.test(bt) ? "Pilot" : true;
    eff.any = eff.any || eff.draw || sp.flicker ? 1 : 0;
    sp.etb = eff.any ? eff : null;
    const ft = String(faces[0].oracle_text ?? "");
    m.prep = {
      spell: sp,
      enters: /enters prepared/i.test(ft),
      onAttack: /whenever this creature attacks, it becomes prepared/i.test(ft),
      upkeep: /at the beginning of your upkeep, if this creature isn't prepared, it becomes prepared/i.test(ft),
    };
    m.textSeen = Math.min(1, (m.textSeen ?? 1) + 0.25);
  }
  if (/whenever you cast a prepared spell, copy it/i.test(frontText)) m.prepCopy = 1;
  if (/when this creature enters, choose up to one[^]*target creature becomes prepared/i.test(frontText)) m.etbPrepare = 1;
}

export function buildDuelDeck(mainText, cards) {
  const idx = indexCards(cards);
  const models = new Map();
  const out = [];
  for (const { qty, name } of parseList(mainText).cards) {
    const card = idx.get(name.toLowerCase());
    if (!models.has(name)) models.set(name, card ? duelModel(card) : { name, land: true, entry: "untapped", triggers: [] });
    for (let i = 0; i < qty; i++) out.push(models.get(name));
  }
  return out;
}

/* ------------------------------------------------------------------ the game */

const pw = (o) => Math.max(0, (o.m.starLands ? o.owner.landsOut : o.m.power) + (o.counters ?? 0) + (o.temp ?? 0) - (o.shrink ?? 0));
const tough = (o) => o.m.toughness + (o.counters ?? 0) - (o.shrink ?? 0);
const isCreature = (o) => o.m.creature;
const objValue = (o) => o.m.value + (o.counters ?? 0) * 0.7 + (o.token ? -0.5 : 0);

/** How a life total weighs damage: the closer to 0, the more each point matters. */
const lifeWeight = (life) => (life <= 0 ? 50 : 0.35 + 3 / Math.max(1, life));

/**
 * Pure combat: attackers [{o}], blocks Map(attacker → [blockers]). Returns who dies and what reaches the player.
 * First strike and double strike get their own damage step; deathtouch kills with 1; trample spills over.
 */
export function resolveCombat(attackers, blocks) {
  const dead = new Set();
  let toPlayer = 0, lifelinkA = 0, lifelinkB = 0;
  const connected = [];
  const dmgOn = new Map();
  const hit = (o, n, src) => {
    if (n <= 0) return;
    dmgOn.set(o, (dmgOn.get(o) ?? 0) + n);
    if (src.m.deathtouch || dmgOn.get(o) >= tough(o)) if (!o.m.indestructible) dead.add(o);
  };
  for (const a of attackers) {
    const bl = blocks.get(a) ?? [];
    const steps = a.m.doubleStrike ? ["first", "regular"] : a.m.firstStrike ? ["first"] : ["regular"];
    if (!bl.length) {
      const n = pw(a) * steps.length;
      toPlayer += n;
      if (a.m.lifelink) lifelinkA += n;
      connected.push({ o: a, amount: n });
      continue;
    }
    for (const step of ["first", "regular"]) {
      // damage in one step is simultaneous: decide everything from who is alive at the start of the step
      const aliveA = !dead.has(a);
      const aliveB = bl.filter((b) => !dead.has(b));
      const pending = [];
      if (steps.includes(step) && aliveA) {
        let left = pw(a);
        for (const b of aliveB) {
          if (left <= 0) break;
          const need = a.m.deathtouch ? 1 : Math.max(0, tough(b) - (dmgOn.get(b) ?? 0));
          const n = Math.min(left, need);
          pending.push([b, n, a]);
          left -= n;
          if (a.m.lifelink) lifelinkA += n;
        }
        if (left > 0 && (a.m.trample || !aliveB.length)) {
          if (a.m.trample) toPlayer += left;
          if (a.m.lifelink) lifelinkA += left;
        } else if (left > 0 && aliveB.length) pending.push([aliveB[aliveB.length - 1], left, a]);
      }
      if (aliveA) for (const b of aliveB) {
        const bSteps = b.m.doubleStrike ? ["first", "regular"] : b.m.firstStrike ? ["first"] : ["regular"];
        if (!bSteps.includes(step)) continue;
        pending.push([a, pw(b), b]);
        if (b.m.lifelink) lifelinkB += pw(b);
      }
      for (const [o, n, src] of pending) hit(o, n, src);
    }
  }
  return { dead, toPlayer, lifelinkA, lifelinkB, connected };
}

const canBlock = (b, a) => !b.tapped && isCreature(b) && !b.m.cantBlock && !a.m.unblockable && (!a.m.flying || b.m.flying || b.m.reach);

/** Score of a combat for the attacker (the defender wants it low). */
function combatScore(att, def, attackers, blocks, attLife, defLife) {
  const r = resolveCombat(attackers, blocks);
  let s = 0;
  for (const o of r.dead) s += o.owner === def ? objValue(o) : -objValue(o);
  const newDef = defLife - r.toPlayer;
  if (newDef <= 0) return 1000;
  s += r.toPlayer * lifeWeight(newDef);
  s += r.lifelinkA * 0.15 - r.lifelinkB * 0.15;
  return s;
}

/** The defender's best block against a given attack: exact search on small boards, greedy otherwise. */
function bestBlocks(att, def, attackers, attLife, defLife) {
  const blockers = def.bf.filter((b) => isCreature(b) && !b.tapped && !b.m.cantBlock);
  const k = attackers.length, n = blockers.length;
  if (!k) return { blocks: new Map(), score: 0 };
  const space = (k + 1) ** n;
  if (space <= 729) {
    let best = null;
    const choice = new Array(n).fill(0);
    for (let code = 0; code < space; code++) {
      let c = code;
      for (let i = 0; i < n; i++) (choice[i] = c % (k + 1)), (c = Math.floor(c / (k + 1)));
      const blocks = new Map();
      let ok = true;
      for (let i = 0; i < n && ok; i++) {
        if (!choice[i]) continue;
        const a = attackers[choice[i] - 1];
        if (!canBlock(blockers[i], a)) ok = false;
        else blocks.set(a, [...(blocks.get(a) ?? []), blockers[i]]);
      }
      if (!ok) continue;
      for (const [a, bl] of blocks) if (a.m.menace && bl.length < 2) ok = false;
      if (!ok) continue;
      const s = combatScore(att, def, attackers, blocks, attLife, defLife);
      if (!best || s < best.score) best = { blocks, score: s };
    }
    return best;
  }
  // greedy: biggest attackers first; block to kill without dying, else trade down, else chump if lethal is coming
  const blocks = new Map();
  const free = new Set(blockers);
  const incoming = attackers.reduce((s, a) => s + pw(a) * (a.m.doubleStrike ? 2 : 1), 0);
  for (const a of [...attackers].sort((x, y) => pw(y) - pw(x))) {
    if (a.m.menace) continue;
    const opts = [...free].filter((b) => canBlock(b, a));
    const kills = (b) => b.m.deathtouch || pw(b) >= tough(a);
    const survives = (b) => !a.m.deathtouch && pw(a) < tough(b);
    const pick = opts.find((b) => kills(b) && survives(b)) ?? opts.find((b) => kills(b) && objValue(b) <= objValue(a)) ?? (incoming >= defLife ? opts.sort((x, y) => objValue(x) - objValue(y))[0] : null);
    if (pick) blocks.set(a, [pick]), free.delete(pick);
  }
  return { blocks, score: combatScore(att, def, attackers, blocks, attLife, defLife) };
}

/** Minimax attack: the attack set whose worst-case (best-block) score is highest, minus crack-back risk. */
export function chooseAttack(att, def) {
  const ready = att.bf.filter((o) => isCreature(o) && !o.sick && !o.tapped && !o.m.defender && pw(o) > 0);
  if (!ready.length) return { attackers: [], blocks: new Map() };
  const n = ready.length;
  const sets = [];
  if (n <= 6) for (let mask = 1; mask < 1 << n; mask++) sets.push(ready.filter((_, i) => mask & (1 << i)));
  else {
    const byPow = [...ready].sort((a, b) => pw(b) - pw(a));
    for (let i = 1; i <= n; i++) sets.push(byPow.slice(0, i));
    sets.push(ready.filter((o) => o.m.flying || o.m.unblockable || o.m.menace));
  }
  const oppPower = def.bf.filter((o) => isCreature(o) && !o.m.defender).reduce((s, o) => s + pw(o), 0);
  let best = { attackers: [], blocks: new Map(), score: 0 };
  let budget = 6000;
  for (const set of sets) {
    if (budget-- <= 0) break;
    const r = bestBlocks(att, def, set, att.life, def.life);
    if (r.score >= 1000) return { attackers: set, blocks: r.blocks, score: r.score };
    // crack-back: attackers without vigilance can't block next turn
    const stayHome = att.bf.filter((o) => isCreature(o) && !o.m.cantBlock && (!set.includes(o) || o.m.vigilance)).length;
    const killed = [...resolveCombat(set, r.blocks).dead].filter((o) => o.owner === def).reduce((s, o) => s + pw(o), 0);
    const back = Math.max(0, oppPower - killed - stayHome * 2);
    const risk = back >= att.life ? 400 : back * lifeWeight(att.life - back) * 0.5;
    const score = r.score - risk;
    if (score > best.score + 1e-9) best = { attackers: set, blocks: r.blocks, score };
  }
  return best;
}

/**
 * One game between two shuffled decks. Returns { winner: 0 | 1 | null, turns }.
 * order0 is on the play.
 */
export function playDuel(order0, order1, { r, maxTurn = 20, log = null } = {}) {
  const L = (...x) => log && log.push(x.join(" "));
  const mk = (order, name) => ({ name, lib: [...order], hand: [], bf: [], grave: [], life: 20, landsOut: 0, tappedLands: 0, treasures: 0, junk: 0, drawsThisTurn: 0, lost: false });
  const P = [mk(order0, 0), mk(order1, 1)];
  const opp = (S) => P[1 - S.name];
  for (const S of P) {
    S.hand = S.lib.splice(0, 7);
    const lands = S.hand.filter((c) => c.land).length;
    if (lands < 2 || lands > 5) {
      S.lib = shuffle([...S.lib, ...S.hand], r);
      S.hand = S.lib.splice(0, 7);
      const L = S.hand.filter((c) => c.land).length;
      const drop = L > 3 ? S.hand.findIndex((c) => c.land) : S.hand.findIndex((c) => !c.land);
      S.lib.push(S.hand.splice(drop, 1)[0]);
    }
  }
  let budget = 0;
  const draw = (S, n) => {
    for (let i = 0; i < n; i++) {
      if (!S.lib.length) {
        S.lost = true;
        return;
      }
      S.hand.push(S.lib.shift());
      S.drawsThisTurn++;
      if (S.drawsThisTurn === 2) fire(S, "draw2");
    }
  };
  const hurt = (T, n) => {
    if (n <= 0) return;
    T.life -= n;
    fire(opp(T), "lifeloss");
  };
  const gain = (S, n) => {
    if (n <= 0) return;
    S.life += n;
    fire(S, "lifegain");
  };
  const doubleFor = (S, src) => {
    if (!src?.m?.creature) return 1;
    const p = pw(src);
    const ok = (d) => d.all || (d.power != null && p <= d.power) || (d.legend && src.m.legend) || (d.type && (src.m.types ?? []).some((x) => x === "*" || x === d.type));
    return S.bf.some((o) => o.m.doubler && ok(o.m.doubler)) ? 2 : 1;
  };
  function enter(S, obj) {
    obj.owner = S;
    S.bf.push(obj);
    if (obj.m.prep?.enters) obj.prepared = true;
    if (obj.m.etbPrepare) {
      const t = S.bf.filter((o) => o !== obj && o.m.prep && !o.prepared).sort((a, b) => b.m.prep.spell.cost - a.m.prep.spell.cost)[0];
      if (t) t.prepared = true;
    }
    if (obj.m.etb) resolve(S, obj.m.etb, obj, doubleFor(S, obj));
    if (obj.m.creature) fire(S, "creature", { obj });
  }
  function die(o, { sacrificed = false } = {}) {
    const S = o.owner;
    const at = S.bf.indexOf(o);
    if (at < 0) return;
    S.bf.splice(at, 1);
    if (!o.token) S.grave.push(o.m);
    if (!isCreature(o)) return;
    for (const x of [...S.bf]) for (const tr of x.m.triggers ?? []) {
      if (tr.ev !== "sac") continue;
      if (!tr.dies && !sacrificed) continue; // "whenever you sacrifice" needs a sacrifice
      if (tr.what !== "creature" && tr.what !== "any" && !(tr.what === "token" && o.token)) continue;
      if (tr.dtOnly && !o.m.deathtouch) continue;
      resolve(S, tr.eff, x, doubleFor(S, x), { obj: o });
    }
    if (o.m.dies) resolve(S, o.m.dies, o, doubleFor(S, o));
  }
  const sacrifice = (S, o) => die(o, { sacrificed: true });
  /** A Treasure, Clue or Lander being sacrificed: "whenever you sacrifice an artifact" (Biotech Specialist). */
  function sacArtifact(S) {
    for (const x of [...S.bf]) for (const tr of x.m.triggers ?? []) {
      if (tr.ev !== "sac" || tr.dies) continue;
      if (tr.what !== "artifact" && tr.what !== "any" && tr.what !== "token") continue;
      resolve(S, tr.eff, x, doubleFor(S, x));
    }
  }
  const targets = (T, rem, src) =>
    T.bf.filter((o) => {
      if (!isCreature(o) || o.m.hexproof) return false;
      const c = rem.cond ?? {};
      if (c.mv != null && o.m.cost > c.mv) return false;
      if (c.power != null && pw(o) > c.power) return false;
      if (c.powerMin != null && pw(o) < c.powerMin) return false;
      if (c.tapped && !o.tapped) return false;
      if (c.flying && !o.m.flying) return false;
      if (c.damaged && !o.damaged) return false;
      if (rem.kind === "kill" && o.m.indestructible) return false;
      if ((rem.kind === "dmg" || rem.kind === "shrink") && tough(o) > rem.n && !src?.m?.deathtouch) return false;
      return true;
    });
  /** The best removal target (most valuable); for bites/fights, pick our attacker too. */
  function useRemoval(S, rem, src) {
    const T = opp(S);
    if (rem.needLands && S.landsOut < rem.needLands) return false;
    if (rem.kind === "edict") {
      const pool = T.bf.filter((o) => isCreature(o) && (!rem.nontoken || !o.token));
      if (!pool.length) return false;
      sacrifice(T, pool.sort((a, b) => objValue(a) - objValue(b))[0]); // they give up their worst
      return true;
    }
    if (rem.kind === "bite" || rem.kind === "fight") {
      const mine = S.bf.filter(isCreature).sort((a, b) => (b.m.deathtouch ? 99 : pw(b)) - (a.m.deathtouch ? 99 : pw(a)))[0];
      if (!mine) return false;
      const theirs = T.bf.filter((o) => isCreature(o) && !o.m.hexproof && (mine.m.deathtouch || pw(mine) >= tough(o))).sort((a, b) => objValue(b) - objValue(a))[0];
      if (!theirs) return false;
      if (rem.kind === "fight" && (theirs.m.deathtouch || pw(theirs) >= tough(mine))) die(mine);
      die(theirs);
      return true;
    }
    const pool = targets(T, rem, src);
    const best = pool.sort((a, b) => objValue(b) - objValue(a))[0];
    if (rem.kind === "dmg" && rem.anyTarget && (!best || objValue(best) < 2 || T.life <= rem.n)) {
      hurt(T, rem.n);
      return true;
    }
    if (!best) return false;
    if (rem.kind === "shrink") {
      best.shrink = (best.shrink ?? 0) + rem.n;
      if (tough(best) <= 0) die(best);
    } else die(best);
    return true;
  }
  function resolve(S, eff, src, times = 1, ctx = {}) {
    if (!eff || budget-- <= 0) return;
    const T = opp(S);
    for (let k = 0; k < times; k++) {
      hurt(T, eff.dmg);
      if (eff.dmgEnteringPower && ctx.obj) hurt(T, pw(ctx.obj));
      if (eff.dmgTreasures) hurt(T, S.treasures);
      if (eff.dmgLands) hurt(T, S.landsOut);
      if (eff.draw) draw(S, eff.draw);
      if (eff.drawAmount) draw(S, ctx.amount ?? 0);
      if (eff.treasureAmount) S.treasures += ctx.amount ?? 0;
      for (const p of eff.tokens ?? []) enter(S, { m: { name: "token", creature: true, power: p, toughness: Math.max(1, p), triggers: [], types: [], value: Math.max(1, p) }, sick: true, counters: 0, token: true });
      S.treasures += eff.treasure ?? 0;
      S.junk += eff.junk ?? 0;
      if (eff.counterSelf && src) src.counters = (src.counters ?? 0) + eff.counterSelf;
      if (eff.counterTarget) {
        const best = S.bf.filter(isCreature).sort((a, b) => pw(b) - pw(a))[0];
        if (best) best.counters += eff.counterTarget;
      }
      if (eff.tempPump) {
        const best = S.bf.filter((o) => isCreature(o) && o !== src).sort((a, b) => pw(b) - pw(a))[0];
        if (best) best.temp = (best.temp ?? 0) + eff.tempPump;
      }
      if (eff.gain) gain(S, eff.gain);
      for (let i = 0; i < (eff.ramp ?? 0); i++) landEnters(S, true);
      for (let i = 0; i < (eff.reanimate ?? 0); i++) {
        const gi = S.grave.reduce((b, c, j) => (c.creature && (b < 0 || c.cost > S.grave[b].cost) ? j : b), -1);
        if (gi >= 0) enter(S, { m: S.grave.splice(gi, 1)[0], sick: true, counters: 0 });
      }
      for (const rem of eff.removal ?? []) useRemoval(S, rem, src);
      if (eff.leaves && src && S.bf.includes(src)) die(src);
    }
  }
  function fire(S, ev, info = {}) {
    for (const o of [...S.bf]) {
      for (const tr of o.m.triggers ?? []) {
        if (tr.ev !== ev) continue;
        if (ev === "creature" && tr.another && info.obj === o) continue;
        if (ev === "creature" && tr.nontoken && info.obj?.token) continue;
        if (ev === "creature" && tr.tribe && !(info.obj?.m.types ?? []).some((x) => x === "*" || x === tr.tribe)) continue;
        if (ev === "cast" && !(tr.kind === "any" || tr.kind === info.kind || (tr.kind === "noncreature" && info.kind === "spell"))) continue;
        if ((ev === "selfattack" || ev === "selfconnect") && info.obj !== o) continue;
        resolve(S, tr.eff, o, doubleFor(S, o), info);
      }
    }
  }
  function landEnters(S, tapped) {
    S.landsOut++;
    if (tapped) S.tappedLands++;
    fire(S, "land");
  }

  function mainPhase(S) {
    const T = opp(S);
    let mana = S.landsOut - S.tappedLands + S.bf.filter((o) => o.m.dork && !(o.sick && o.m.creature)).length - (S.spent ?? 0);
    const avail = () => mana + S.treasures;
    const pay = (n) => {
      const u = Math.min(mana, n);
      mana -= u;
      S.treasures -= n - u;
      for (let i = 0; i < n - u; i++) sacArtifact(S);
    };
    const fodder = () => S.bf.find((o) => o.token && isCreature(o)) ?? S.bf.filter((o) => isCreature(o) && (o.m.dies || pw(o) <= 1)).sort((a, b) => objValue(a) - objValue(b))[0];
    const blinkTarget = (S, skip) =>
      S.bf.filter((o) => isCreature(o) && o !== skip && !(o.m.types ?? []).includes("Pilot") && !o.token).sort((a, b) => (b.m.prep?.enters && !b.prepared ? 10 + b.m.prep.spell.cost : b.m.etb ? 1 : 0) - (a.m.prep?.enters && !a.prepared ? 10 + a.m.prep.spell.cost : a.m.etb ? 1 : 0))[0];
    for (let guard = 0; guard < 20; guard++) {
      const prepOpts = S.bf
        .filter((o) => o.prepared && o.m.prep.spell.cost <= avail())
        .map((o) => {
          const c = o.m.prep.spell;
          let v = 0;
          if (c.spellRemoval?.length) {
            const rem = c.spellRemoval[0];
            const t = targets(T, rem, null).sort((a, b) => objValue(b) - objValue(a))[0];
            v = t ? objValue(t) + 0.5 : rem.anyTarget ? (T.life <= rem.n ? 99 : 0.6) : 0;
          } else if (c.flicker) {
            const t = blinkTarget(S, o);
            v = t && t.m.prep?.enters && !t.prepared ? 2.5 : 0;
          } else if (c.etb?.any) v = c.cost + 0.5;
          return { c, o, v };
        });
      const opts = S.hand
        .map((c, i) => ({ c, i }))
        .filter(({ c }) => !c.land && c.cost <= avail() && (!c.needsSac || S.junk > 0 || fodder()))
        .map(({ c, i }) => {
          // what casting it now is worth
          let v = 0;
          if (c.creature) v = c.value + 1;
          else if (c.spellRemoval?.length) {
            const rem = c.spellRemoval[0];
            if (rem.kind === "edict") v = T.bf.some(isCreature) ? 3 : 0;
            else if (rem.kind === "bite" || rem.kind === "fight") v = S.bf.some(isCreature) && T.bf.some(isCreature) ? 3 : 0;
            else {
              const t = targets(T, rem, null).sort((a, b) => objValue(b) - objValue(a))[0];
              v = t ? objValue(t) + 0.5 : rem.anyTarget ? (T.life <= rem.n ? 99 : 0.6) : 0;
            }
            if (c.etb?.any) v += 1;
          } else if (c.etb?.any || c.pump || c.triggers.length || c.doubler || c.dork || c.extraLand || c.sacOutlet) v = c.cost + 0.5;
          return { c, i, v };
        })
        .filter((x) => x.v > 0.5)
        .concat(prepOpts.filter((x) => x.v > 0.5))
        .sort((a, b) => b.v - a.v || b.c.cost - a.c.cost);
      if (!opts.length) break;
      if (opts[0].o) {
        // cast a copy of a prepared creature's spell; Codie-style copiers copy it again (Delney doubles them)
        const { c, o } = opts[0];
        o.prepared = false;
        L(`  P${S.name} casts prepared ${c.name}`);
        pay(c.cost);
        fire(S, "cast", { kind: "spell" });
        const copies = 1 + S.bf.filter((x) => x.m.prepCopy).reduce((n, x) => n + doubleFor(S, x), 0);
        for (let k = 0; k < copies && budget > 0; k++) {
          if (c.etb) resolve(S, c.etb, null);
          for (const rem of c.spellRemoval ?? []) if (useRemoval(S, rem, null)) break;
          if (c.flicker) {
            const t = blinkTarget(S, o);
            if (t) {
              S.bf.splice(S.bf.indexOf(t), 1);
              enter(S, { m: t.m, sick: true, counters: 0 });
            }
          }
        }
        if (T.life <= 0 || S.lost || T.lost) return;
        continue;
      }
      const { c, i } = opts[0];
      S.hand.splice(i, 1);
      L(`  P${S.name} casts ${c.name}`);
      pay(c.cost);
      if (c.needsSac) {
        if (S.junk > 0) S.junk--, sacArtifact(S);
        else sacrifice(S, fodder());
      }
      fire(S, "cast", { kind: c.spell ? "spell" : c.creature ? "creature" : "noncreature" });
      if (c.spell) {
        if (c.etb) resolve(S, c.etb, null);
        for (const rem of c.spellRemoval ?? []) if (useRemoval(S, rem, null)) break; // a modal spell uses one mode
        S.grave.push(c);
      } else if (c.pump && !c.creature) {
        const best = S.bf.filter(isCreature).sort((a, b) => pw(b) - pw(a))[0];
        if (best) best.counters += c.pump;
        S.bf.push({ m: { ...c, etb: null }, owner: S, counters: 0 });
        if (c.etb) resolve(S, c.etb, null);
      } else enter(S, { m: c, sick: !c.haste, counters: 0 });
      if (T.life <= 0 || S.lost || T.lost) return;
    }
    S.spent = S.landsOut - S.tappedLands - Math.max(0, mana); // mana used this turn
  }

  function combat(S) {
    const T = opp(S);
    const { attackers, blocks } = chooseAttack(S, T);
    if (!attackers.length) return;
    L(`  P${S.name} attacks with ${attackers.map((a) => `${a.m.name} ${pw(a)}/${tough(a)}`).join(", ")}`);
    fire(S, "attack");
    for (const a of attackers) {
      if (a.m.prep?.onAttack) a.prepared = true;
      if (!a.m.vigilance) a.tapped = true;
      fire(S, "selfattack", { obj: a });
    }
    // blocks were chosen by the defender against this attack; recompute in case triggers changed the board
    const live = attackers.filter((a) => S.bf.includes(a));
    const { blocks: bl } = bestBlocks(S, T, live, S.life, T.life);
    const res = resolveCombat(live, bl);
    L(`    blocks: ${[...bl].map(([a, b]) => `${b.map((x) => x.m.name).join("+")} on ${a.m.name}`).join("; ") || "none"} → ${res.toPlayer} to player; dies: ${[...res.dead].map((o) => `P${o.owner.name} ${o.m.name}`).join(", ") || "none"}`);
    for (const o of res.dead) o.damaged = true;
    hurt(T, res.toPlayer);
    if (res.lifelinkA) gain(S, res.lifelinkA);
    if (res.lifelinkB) gain(T, res.lifelinkB);
    for (const { o, amount } of res.connected) {
      fire(S, "selfconnect", { obj: o, amount });
      fire(S, "connect");
    }
    for (const o of res.dead) die(o);
  }

  for (let turn = 1; turn <= maxTurn * 2; turn++) {
    const S = P[(turn - 1) % 2];
    const T = opp(S);
    budget = 500;
    L(`T${Math.ceil(turn / 2)} P${S.name} (life ${S.life} vs ${T.life}; board ${S.bf.filter(isCreature).map((o) => o.m.name).join(", ") || "-"} | ${T.bf.filter(isCreature).map((o) => o.m.name).join(", ") || "-"}; hand ${S.hand.length})`);
    S.drawsThisTurn = 0;
    S.spent = 0;
    S.tappedLands = 0;
    for (const o of S.bf) (o.sick = false), (o.tapped = false), (o.temp = 0);
    for (const o of [...S.bf, ...T.bf]) (o.shrink = 0), (o.damaged = false);
    for (const o of S.bf) if (o.m.prep?.upkeep) o.prepared = true;
    fire(S, "upkeep");
    if (turn > 1) draw(S, 1);
    if (S.lost) return { winner: T.name, turns: Math.ceil(turn / 2), reason: "deck" };
    let drops = S.bf.some((o) => o.m.extraLand) ? 2 : 1;
    while (drops-- > 0) {
      const li = S.hand.findIndex((c) => c.land);
      if (li < 0) break;
      const L = S.hand.splice(li, 1)[0];
      const tapped = L.entry === "tapped" || (L.entry === "late" && S.landsOut < 2) || (L.entry === "early" && S.landsOut >= 3);
      landEnters(S, tapped);
      if (L.fetch) fire(S, "land");
    }
    mainPhase(S);
    if (T.life <= 0 || T.lost) return { winner: S.name, turns: Math.ceil(turn / 2) };
    if (S.life <= 0) return { winner: T.name, turns: Math.ceil(turn / 2) };
    combat(S);
    if (T.life <= 0) return { winner: S.name, turns: Math.ceil(turn / 2) };
    if (S.life <= 0) return { winner: T.name, turns: Math.ceil(turn / 2) };
    mainPhase(S);
    if (T.life <= 0 || T.lost) return { winner: S.name, turns: Math.ceil(turn / 2) };
    if (S.bf.some((o) => o.m.sacOutlet)) {
      // a free outlet turns spare artifacts and tokens into whatever the deck's sacrifice payoffs give
      while (S.junk > 0 && budget > 0) S.junk--, sacArtifact(S);
      for (let f = S.bf.find((o) => o.token && isCreature(o)); f && budget > 0; f = S.bf.find((o) => o.token && isCreature(o))) sacrifice(S, f);
    }
    fire(S, "end");
    if (T.life <= 0) return { winner: S.name, turns: Math.ceil(turn / 2) };
    if (S.life <= 0) return { winner: T.name, turns: Math.ceil(turn / 2) };
  }
  return { winner: null, turns: maxTurn, reason: "timeout" };
}

/**
 * Deck A vs deck B over `games` games. Game g uses seed g for both shuffles and alternates who is
 * on the play, so a changed version of A meets the same draws. Returns win rate for A (draws count half).
 */
export function matchup(deckA, deckB, { games = 600, seed0 = 1 } = {}) {
  const res = [];
  for (let g = 0; g < games; g++) {
    const r = rng(seed0 + g * 7919);
    const a = shuffle([...deckA], r), b = shuffle([...deckB], r);
    const aPlay = g % 2 === 0;
    const out = aPlay ? playDuel(a, b, { r }) : playDuel(b, a, { r });
    const aWon = out.winner == null ? 0.5 : (out.winner === 0) === aPlay ? 1 : 0;
    res.push({ aWon, aPlay, turns: out.turns, reason: out.reason ?? "life" });
  }
  const rate = (xs) => (xs.length ? xs.reduce((s, x) => s + x.aWon, 0) / xs.length : null);
  const all = rate(res);
  const se = Math.sqrt(Math.max(1e-9, all * (1 - all)) / res.length);
  return { games, win: +all.toFixed(3), se: +se.toFixed(3), onPlay: +rate(res.filter((x) => x.aPlay)).toFixed(3), onDraw: +rate(res.filter((x) => !x.aPlay)).toFixed(3), avgTurns: +(res.reduce((s, x) => s + x.turns, 0) / res.length).toFixed(1), reasons: res.reduce((m, x) => ((m[x.reason] = (m[x.reason] ?? 0) + 1), m), {}), results: res.map((x) => x.aWon) };
}

/** Paired change in win rate when A is swapped for A2 (same opponent, same games). */
export function pairedWin(a, b) {
  const d = a.results.map((x, i) => b.results[i] - x);
  const n = d.length;
  const mean = d.reduce((s, x) => s + x, 0) / n;
  const sd = Math.sqrt(d.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, n - 1));
  return { delta: +mean.toFixed(3), se: +(sd / Math.sqrt(n)).toFixed(3) };
}

/** Share of a deck's nonland card text the sim understands (copy-weighted). Low means "trust this matchup less". */
export function coverage(deck) {
  const nl = deck.filter((m) => !m.land);
  return nl.length ? +(nl.reduce((s, m) => s + (m.textSeen ?? 1), 0) / nl.length).toFixed(2) : 1;
}
