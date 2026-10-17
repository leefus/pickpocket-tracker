/**
 * What the card viewer shows: image and text for one card. Pure, so it runs under `node --test`.
 * Works on the slim card objects from lib/scryfall.js and on raw Scryfall API cards.
 */
const face = (f, img) => ({
  name: f.name,
  cost: f.mana_cost || "",
  type: f.type_line || "",
  text: f.oracle_text || "",
  pt: f.power != null && f.toughness != null ? `${f.power}/${f.toughness}` : null,
  image: img ?? f.image ?? f.image_uris?.normal ?? null,
});

export function toCardInfo(card) {
  if (!card) return null;
  const faces = (card.card_faces ?? []).map((f) => face(f));
  const main = face(card, card.image ?? card.image_uris?.normal ?? faces[0]?.image);
  // Double-faced and split cards keep their rules text on the faces.
  return { ...main, faces: faces.length > 1 ? faces : [], uri: card.scryfall_uri ?? null };
}

/** name (lower case, plus front-face name) → card info, for every card the page already has. */
export function cardInfoMap(cards = []) {
  const out = {};
  for (const c of cards) {
    const info = toCardInfo(c);
    if (!info) continue;
    out[c.name.toLowerCase()] = info;
    const front = c.name.split(" // ")[0].toLowerCase();
    out[front] ??= info;
  }
  return out;
}

/** "2 Kain, Traitorous Dragoon, 1 Liliana the Faultless" → [{qty: 2, name: "Kain, Traitorous Dragoon"}, ...]. */
export function splitCardList(text = "") {
  return String(text)
    .split(/,\s*(?=\d+\s)/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const m = s.match(/^(\d+)\s+(.+)$/);
      return m ? { qty: Number(m[1]), name: m[2].trim() } : { qty: null, name: s };
    });
}
