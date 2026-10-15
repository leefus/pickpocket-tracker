/**
 * Parse and check decklists pasted in MTG Arena export format.
 * Pure, so it runs under `node --test`.
 */

export const BASIC_LANDS = new Set([
  "Plains", "Island", "Swamp", "Mountain", "Forest", "Wastes",
  "Snow-Covered Plains", "Snow-Covered Island", "Snow-Covered Swamp",
  "Snow-Covered Mountain", "Snow-Covered Forest",
]);

const HEADERS = /^(deck|main ?deck|maindeck|sideboard|commander|companion|about|name .*)$/i;

/**
 * "4 Lich's Relic (FRA) 57" → { qty: 4, name: "Lich's Relic" }.
 * Accepts "4x Name", strips Arena set codes and collector numbers, and
 * merges repeated lines.
 */
export function parseList(text) {
  const byName = new Map();
  const errors = [];
  String(text ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .forEach((line, i) => {
      if (!line || HEADERS.test(line) || line.startsWith("//") || line.startsWith("#")) return;
      const m = line.match(/^(\d{1,3})x?\s+(.+?)(?:\s+\([A-Z0-9]{2,6}\)(?:\s+\S+)?)?\s*$/i);
      if (!m) {
        errors.push(`Line ${i + 1} isn't "count card name": ${line}`);
        return;
      }
      const qty = Number(m[1]);
      const name = m[2].trim();
      if (qty < 1) {
        errors.push(`Line ${i + 1} has a count of 0: ${line}`);
        return;
      }
      byName.set(name, (byName.get(name) ?? 0) + qty);
    });
  const cards = [...byName.entries()].map(([name, qty]) => ({ qty, name }));
  return { cards, count: cards.reduce((s, c) => s + c.qty, 0), errors };
}

/** Constructed rules: 60+ main, at most 15 sideboard, at most 4 of a non-basic across both. */
export function checkDeck(mainText, sideText) {
  const main = parseList(mainText);
  const side = parseList(sideText);
  const errors = [...main.errors, ...side.errors.map((e) => `Sideboard: ${e}`)];
  if (main.count < 60) errors.push(`The main deck has ${main.count} cards. It needs at least 60.`);
  if (side.count > 15) errors.push(`The sideboard has ${side.count} cards. It can have at most 15.`);
  const totals = new Map();
  for (const c of [...main.cards, ...side.cards]) totals.set(c.name, (totals.get(c.name) ?? 0) + c.qty);
  for (const [name, n] of totals) {
    if (n > 4 && !BASIC_LANDS.has(name)) errors.push(`${name} appears ${n} times across main and sideboard. The limit is 4.`);
  }
  return { main, side, errors };
}

/** "Boros Dragons | 4 Get Lost | 3 Requiting Hex" per line → rows. */
export function parseGuide(text) {
  return String(text ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [opp, ins = "", outs = ""] = l.split("|").map((s) => s.trim());
      return { opp, ins, outs };
    })
    .filter((r) => r.opp);
}

/** Cards a player might flag as dead: every non-basic in the 75, plus two mana problems. */
export function deadCardChoices(mainText, sideText) {
  const names = [...parseList(mainText).cards, ...parseList(sideText).cards]
    .map((c) => c.name)
    .filter((n) => !BASIC_LANDS.has(n));
  return [...new Set(names), "Too many lands", "Too few lands"];
}
