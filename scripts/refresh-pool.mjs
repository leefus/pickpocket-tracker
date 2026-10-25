// Refresh lib/data/standard-pool.json (every Standard-legal nonland card, slimmed) from Scryfall.
// Run after each set release:  node scripts/refresh-pool.mjs
import fs from "fs";

const slim = (c) => {
  const o = { name: c.name, mana_cost: c.mana_cost ?? null, cmc: c.cmc, type_line: c.type_line ?? null, oracle_text: c.oracle_text ?? null, color_identity: c.color_identity ?? [], power: c.power ?? null, toughness: c.toughness ?? null };
  if (c.keywords?.length) o.keywords = c.keywords;
  if (c.card_faces) o.card_faces = c.card_faces.map((f) => ({ name: f.name, mana_cost: f.mana_cost, type_line: f.type_line, oracle_text: f.oracle_text, power: f.power, toughness: f.toughness }));
  return o;
};

async function search(q, map) {
  let url = "https://api.scryfall.com/cards/search?q=" + encodeURIComponent(q) + "&unique=cards&order=name";
  const cards = [];
  while (url) {
    let res;
    for (let tries = 0; tries < 5; tries++) {
      res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "MTGDeckStatsTracker/1.0" } });
      if (res.status !== 429) break;
      await new Promise((r) => setTimeout(r, 2000 * (tries + 1))); // rate-limited: back off and retry
    }
    if (!res.ok) throw new Error(`Scryfall answered ${res.status}`);
    const j = await res.json();
    cards.push(...j.data.map(map));
    url = j.has_more ? j.next_page : null;
    await new Promise((r) => setTimeout(r, 250)); // Scryfall asks for at most 10 requests a second
  }
  return cards;
}
const updated = new Date().toISOString().slice(0, 10);
const cards = await search("f:standard -t:land", slim);
fs.writeFileSync(new URL("../lib/data/standard-pool.json", import.meta.url), JSON.stringify({ updated, source: "Scryfall search f:standard -t:land", cards }));
// Nonbasic lands, for the seed builder's mana base
const lands = await search("f:standard t:land -t:basic", (c) => ({ ...slim(c), produced_mana: c.produced_mana ?? [] }));
fs.writeFileSync(new URL("../lib/data/standard-lands.json", import.meta.url), JSON.stringify({ updated, source: "Scryfall search f:standard t:land -t:basic", cards: lands }));
console.log(`${cards.length} cards, ${lands.length} lands, ${updated}`);
