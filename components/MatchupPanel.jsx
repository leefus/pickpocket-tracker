"use client";

import { useState, useTransition } from "react";
import { simulateMatchups } from "@/app/actions";

const pc = (x) => (x == null ? "—" : `${Math.round(x * 100)}%`);
const tone = (w) => (w >= 0.55 ? "good" : w <= 0.45 ? "bad" : "warn");

/**
 * Simulated matchups: this deck against the meta decks and the other tracker decks, both sides played
 * by the same rule-based player (lib/duel.mjs). `logged` maps an opponent name to its logged record.
 */
export default function MatchupPanel({ deck, logged = {} }) {
  const [res, setRes] = useState(null);
  const [pending, start] = useTransition();
  const run = () =>
    start(async () => {
      setRes(await simulateMatchups(deck.id));
    });
  return (
    <section id="matchups">
      <h2>Simulated matchups</h2>
      <p className="sub small">
        Both decks play 300 games against each other, taking turns on the play. The sim blocks, trades, uses removal and fires death
        triggers, which the goldfish can&apos;t do. Attacks are chosen by <b>minimax</b>: each possible attack is scored against the
        defender&apos;s best block, and the attack with the best worst case wins. Everything else follows simple rules, and everything
        happens at sorcery speed.
      </p>
      <p className="sub small">
        Read it as which matchups are better or worse, not as real win rates. It plays bigger creatures and plain removal well, and it
        underrates counterspells, instant-speed tricks and card-advantage engines. Each row shows how much of that deck&apos;s card text the
        sim understands. The lower that number, the less weight the row deserves.
      </p>
      <div className="claude-line">
        <button type="button" onClick={run} disabled={pending}>
          {pending ? "Playing the games (about 15 seconds)…" : res ? "Run again" : "Simulate matchups"}
        </button>
        {res?.coverage != null && <span className="sub small">The sim understands {pc(res.coverage)} of your deck&apos;s card text.</span>}
      </div>
      {res?.error && <p className="msg err">{res.error}</p>}
      {res?.rows && (
        <div className="tbl">
          <table>
            <thead>
              <tr>
                <th>Opponent</th>
                <th className="r">Sim win</th>
                <th className="r">On play</th>
                <th className="r">On draw</th>
                <th className="r">Turns</th>
                <th className="r" title="how much of the opponent's card text the sim understands">Sim sees</th>
                <th className="r">Logged</th>
              </tr>
            </thead>
            <tbody>
              {[...res.rows]
                .sort((a, b) => a.win - b.win)
                .map((r) => (
                  <tr key={r.key}>
                    <td>
                      {r.name} {r.kind === "tracker" && <span className="chip">your deck</span>}
                    </td>
                    <td className="r">
                      <span className={`pill ${tone(r.win)}`}>{pc(r.win)}</span> <span className="sub small num">±{Math.round(r.se * 200)}</span>
                    </td>
                    <td className="r num">{pc(r.onPlay)}</td>
                    <td className="r num">{pc(r.onDraw)}</td>
                    <td className="r num">{r.avgTurns}</td>
                    <td className="r num">{pc(r.coverage)}</td>
                    <td className="r num">{logged[r.name] ?? "—"}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
      {res?.rows && (
        <p className="sub small">
          Worst matchup first. ± is two standard errors. When a row has logged matches, trust those over the sim. Use <b>Duel-test my picks</b>{" "}
          in the Roles panel to check a swap against one opponent on the same games.
        </p>
      )}
    </section>
  );
}
