/**
 * Card data from Scryfall (https://scryfall.com/docs/api), server-side only.
 * Card text rarely changes, so results are cached for a week per decklist.
 */
import "server-only";
import { unstable_cache } from "next/cache";
import { parseList } from "./decklist.mjs";

const FIELDS = ["name", "layout", "mana_cost", "cmc", "type_line", "oracle_text", "produced_mana", "colors", "power", "toughness", "keywords"];
const slim = (c) => ({
  ...Object.fromEntries(FIELDS.map((k) => [k, c[k] ?? null])),
  card_faces: c.card_faces?.map((f) => ({ name: f.name, mana_cost: f.mana_cost, type_line: f.type_line, oracle_text: f.oracle_text, power: f.power, toughness: f.toughness })) ?? null,
});

async function fetchCollection(names) {
  const out = [];
  // The collection endpoint takes up to 75 identifiers per request.
  for (let i = 0; i < names.length; i += 75) {
    const res = await fetch("https://api.scryfall.com/cards/collection", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": "PickpocketTracker/1.0" },
      body: JSON.stringify({ identifiers: names.slice(i, i + 75).map((name) => ({ name })) }),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Scryfall answered ${res.status}`);
    const json = await res.json();
    out.push(...json.data.map(slim));
    if (i + 75 < names.length) await new Promise((r) => setTimeout(r, 100)); // Scryfall asks for ≤10 requests a second
  }
  return out;
}

const cached = unstable_cache(async (key) => fetchCollection(JSON.parse(key)), ["scryfall-collection-v2"], { revalidate: 60 * 60 * 24 * 7 });

/** Card data for every card in the main deck and sideboard, or { error } if Scryfall can't be reached. */
export async function getCardData(mainText, sideText) {
  const names = [...new Set([...parseList(mainText).cards, ...parseList(sideText).cards].map((c) => c.name))].sort();
  if (!names.length) return { cards: [] };
  try {
    return { cards: await cached(JSON.stringify(names)) };
  } catch (err) {
    console.error("scryfall lookup failed", err);
    return { cards: [], error: "Couldn't reach Scryfall for card data, so the mana and curve checks are missing. Reload in a minute." };
  }
}
