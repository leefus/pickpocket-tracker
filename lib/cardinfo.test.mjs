import test from "node:test";
import assert from "node:assert/strict";
import { cardInfoMap, splitCardList, toCardInfo } from "./cardinfo.mjs";

test("a normal card: image, cost, type, text and P/T", () => {
  const i = toCardInfo({ name: "Kain, Traitorous Dragoon", mana_cost: "{2}{B}", type_line: "Legendary Creature — Human Knight", oracle_text: "Jump — ...", power: "2", toughness: "4", image: "https://cards.scryfall.io/normal/kain.jpg", scryfall_uri: "https://scryfall.com/card/fin/105" });
  assert.equal(i.pt, "2/4");
  assert.equal(i.image, "https://cards.scryfall.io/normal/kain.jpg");
  assert.equal(i.faces.length, 0);
});

test("a double-faced card keeps both faces and uses the front image", () => {
  const raw = { name: "Sephiroth, Fabled SOLDIER // Sephiroth, One-Winged Angel", card_faces: [
    { name: "Sephiroth, Fabled SOLDIER", mana_cost: "{2}{B}", type_line: "Legendary Creature", oracle_text: "front", power: "3", toughness: "3", image_uris: { normal: "front.jpg" } },
    { name: "Sephiroth, One-Winged Angel", mana_cost: "", type_line: "Legendary Creature", oracle_text: "back", power: "5", toughness: "5", image_uris: { normal: "back.jpg" } } ] };
  const i = toCardInfo(raw);
  assert.equal(i.image, "front.jpg");
  assert.deepEqual(i.faces.map((f) => f.image), ["front.jpg", "back.jpg"]);
  const map = cardInfoMap([raw]);
  assert.ok(map["sephiroth, fabled soldier"], "front-face name finds the card");
});

test("guide lists split on quantities, not on commas inside names", () => {
  assert.deepEqual(splitCardList("2 Kain, Traitorous Dragoon, 1 Liliana the Faultless"), [
    { qty: 2, name: "Kain, Traitorous Dragoon" },
    { qty: 1, name: "Liliana the Faultless" },
  ]);
  assert.deepEqual(splitCardList(""), []);
});
