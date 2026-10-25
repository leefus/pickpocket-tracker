// Distinct harmful things a card does TO THE OPPONENT, from its text.
// Strict: each kind counts once per card; self-only effects don't count.
export const HARMS = [
  ["drain", "makes them lose life / damages them", /(each|target) opponents? loses? \w+ life|deals? (\w+|x) damage to (each opponent|target opponent|target player|that player|each player)|any number of target players each[^.]*lose \w+ life|opponents? lose \w+ life/i],
  ["discard", "makes them discard", /(each|target) opponents? discards?|any number of target players each discard|target player discards|that player discards/i],
  ["removal", "removes their creature or permanent", /destroy (up to (one|two) |another |each |all )?(other )?(target |)(creature|planeswalker|nonland permanent|permanent|artifact|enchantment|battle)s?|destroy target non-?\w+ creature|exile (up to one )?target (creature|nonland permanent|permanent|artifact|enchantment)|deals? \w+ damage to (target creature|any target|each creature|target (creature or )?planeswalker|up to one target creature)|fights? (up to one )?target creature|return (all|each) (non-?\w+ )?creatures?|shuffle[^.]*target creature[^.]*into (its|their) owners'? librar/i],
  ["counter", "counters their spell", /counter target/i],
  ["tap", "taps, stuns or freezes their creatures", /tap (up to (one|two) )?target creatures?|stun counter|(enchanted|target) (creature|permanent)[^.]*doesn't untap|target creatures?[^.]*can't block|creatures? (your opponents control|target opponent controls|defending player controls) can't block|tap (all|each) creatures? (your opponents control|target opponent controls)/i],
  ["mill", "mills them", /(target player|target opponent|each opponent|any number of target players each|target players each) mills?/i],
  ["steal", "steals or plays their cards", /gain control of|cast[^.]*(that player's graveyard|an opponent's graveyard|the exiled (nonland )?card)|play the exiled card|spells? you don't own|exile the top card of (that player's|target opponent's|each opponent's) library/i],
  ["restrict", "restricts what they can do", /(opponents|players) can't cast|can't cast spells during|activated abilities of[^.]*can't be activated|(target|enchanted)[^.]*loses all abilities|loses all abilities for as long|spells your opponents cast cost|can't attack you|(players|your opponents) can't gain life|(players|opponents) can't draw/i],
  ["bounce", "bounces their permanent", /return (target|up to one target|another target) (tapped )?(nonland permanent|creature|permanent|artifact|enchantment)[^.]*owner's hand/i],
  ["edict", "makes them sacrifice", /(each|target) opponents? sacrifices?|each player sacrifices/i],
  ["shrink", "shrinks their creatures", /target creature (an opponent controls )?gets -\d|creatures your opponents control get -\d|-\d\/-\d counter on (target|each) creature/i],
  ["graveyard", "exiles their graveyard", /exile (target player's graveyard|all cards from|each opponent's graveyard|target card from a graveyard|up to \w+ target cards? from (a|their|an opponent's) graveyard)/i],
];

const textOf = (c) => [c.oracle_text, ...(c.card_faces ?? []).map((f) => f.oracle_text)].filter(Boolean).join("\n").replace(/\([^)]*\)/g, "");

export function harmsOf(card) {
  const t = textOf(card);
  // "Choose one": the modes are alternatives, so all of them together count as one harm.
  const lines = t.split("\n");
  const modal = /choose one\b/i.test(t);
  const fixed = modal ? lines.filter((l) => !l.trim().startsWith("•")).join("\n") : t;
  const modes = modal ? lines.filter((l) => l.trim().startsWith("•")).join("\n") : "";
  const out = HARMS.filter(([, , re]) => re.test(fixed)).map(([id]) => id);
  if (modal) {
    const m = HARMS.find(([id, , re]) => !out.includes(id) && re.test(modes));
    if (m) out.push(m[0]);
  }
  // An evasive attacker with real power is a harmful thing on its own.
  const ty = card.card_faces?.[0]?.type_line ?? card.type_line ?? "";
  const pw = Number(card.power ?? card.card_faces?.find((f) => f.power != null)?.power ?? 0) || 0;
  if (/\bCreature\b/.test(ty) && pw >= 2 && /(^|\n)(Flash\n)?(Flying|Menace|Trample)\b|can't be blocked/i.test(t)) out.push("evasive");
  return out;
}
