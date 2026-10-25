// Refresh lib/data/standard-pool.json (every Standard-legal nonland card, slimmed) from Scryfall.
// Run after each set release:  node scripts/refresh-pool.mjs
import fs from "fs";

const slim = (c) => {
  const o = { name: c.name, mana_cost: c.mana_cost ?? null, cmc: c.cmc, type_line: c.type_line ?? null, oracle_text: c.oracle_text ?? null, color_identity: c.color_identity ?? [], power: c.power ?? null, toughness: c.toughness ?? null };
  if (c.keywords?.length) o.keywords = c.keywords;
  if (c.card_faces) o.card_faces = c.card_faces.map((f) => ({ name: f.name, mana_cost: f.mana_cost, type_line: f.type_line, oracle_text: f.oracle_text, power: f.power, toughness: f.toughness }));
  return o;
};

let url = "https://api.scryfall.com/cards/search?q=" + encodeURIComponent("f:standard -t:land") + "&unique=cards&order=name";
const cards = [];
while (url) {
  const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "MTGDeckStatsTracker/1.0" } });
  if (!res.ok) throw new Error(`Scryfall answered ${res.status}`);
  const j = await res.json();
  cards.push(...j.data.map(slim));
  url = j.has_more ? j.next_page : null;
  await new Promise((r) => setTimeout(r, 120)); // Scryfall asks for at most 10 requests a second
}
const out = { updated: new Date().toISOString().slice(0, 10), source: "Scryfall search f:standard -t:land", cards };
fs.writeFileSync(new URL("../lib/data/standard-pool.json", import.meta.url), JSON.stringify(out));
console.log(`${cards.length} cards, ${out.updated}`);
