"use client";

import { useState, useTransition } from "react";
import { metaThreats } from "@/app/actions";

const pc = (x) => (x == null ? "—" : `${Math.round(x * 100)}%`);
const list = (rows) => rows.map((r) => `${r.qty} ${r.name}`).join(", ");

/**
 * Meta-threat check: cheap answers (mana value 3 or less) that kill a 5/5 flier, and the meta decks'
 * big creatures (power 4+, mana value 5 or less). From the 2026-10 study: a deck's worst matchup was
 * usually decided by whether it could answer Boros Dragons' 4- and 5-mana fliers.
 */
export default function ThreatPanel({ deck }) {
  const [res, setRes] = useState(null);
  const [pending, start] = useTransition();
  const run = () =>
    start(async () => {
      setRes(await metaThreats(deck.id));
    });
  const verdict = (r) =>
    r.count >= 8
      ? { tone: "good", text: "Enough cheap answers for the big threats." }
      : r.count >= 5
        ? { tone: "warn", text: "Some answers. Fine against most decks, thin against Boros Dragons." }
        : { tone: "bad", text: "Too few cheap answers. Decks with big fliers will race you. Aim for 8 or more in the main." };
  return (
    <section id="threats">
      <h2>Meta-threat check</h2>
      <p className="sub small">
        Counts your cheap answers: cards that cost 3 or less and can kill a 5/5 flier. Then lists each meta deck&apos;s big creatures (power
        4 or more, costing 5 or less). In our tests, the decks with 8 or more cheap answers in the main had the best worst matchup.
      </p>
      <div className="claude-line">
        <button type="button" onClick={run} disabled={pending}>
          {pending ? "Checking…" : res ? "Check again" : "Check meta threats"}
        </button>
      </div>
      {res?.error && <p className="msg err">{res.error}</p>}
      {res?.decks && (
        <>
          <p>
            <span className={`pill ${verdict(res).tone}`}>{res.count} in the main</span> {verdict(res).text}
          </p>
          <p className="sub small">
            Main: {res.main.length ? list(res.main) : "none"}. Sideboard: {res.side.length ? list(res.side) : "none"}.
          </p>
          <p className="sub small">
            Chance of at least one by turn 4: {pc(res.odds.play)} on the play, {pc(res.odds.draw)} on the draw. With every sideboard answer
            in: {pc(res.boarded.play)} / {pc(res.boarded.draw)}.
          </p>
          <div className="tbl">
            <table>
              <thead>
                <tr>
                  <th>Meta deck</th>
                  <th className="r">Big threats</th>
                  <th className="r">Fliers</th>
                  <th>Which</th>
                </tr>
              </thead>
              <tbody>
                {[...res.decks]
                  .sort((a, b) => b.fliers - a.fliers || b.count - a.count)
                  .map((d) => (
                    <tr key={d.key}>
                      <td>{d.name}</td>
                      <td className="r num">{d.count}</td>
                      <td className="r num">{d.fliers}</td>
                      <td className="small">
                        {d.threats.length
                          ? d.threats.map((t) => `${t.qty} ${t.name} (${t.mv} mana, ${t.power} power${t.flying ? ", flying" : ""})`).join("; ")
                          : "none"}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <p className="sub small">
            The check reads card text with patterns, so it can miss an unusual answer, like a fight spell or a bounce spell. It doesn&apos;t
            count blockers.
          </p>
        </>
      )}
    </section>
  );
}
