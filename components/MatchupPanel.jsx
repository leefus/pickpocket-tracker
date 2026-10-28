"use client";

import { useState, useTransition } from "react";
import { simulateMatchups, testSideboardPlan } from "@/app/actions";
import { planFor } from "@/lib/sideplan.mjs";

const pc = (x) => (x == null ? "—" : `${Math.round(x * 100)}%`);
const tone = (w) => (w >= 0.55 ? "good" : w <= 0.45 ? "bad" : "warn");
const planText = (p) => (p ? [...p.ins.map((r) => `+${r.qty} ${r.name}`), ...p.outs.map((r) => `-${r.qty} ${r.name}`)].join(" ") : "");

/** Test an in/out plan against one opponent, on the same games as the main deck. */
function PlanTester({ deck, rows }) {
  const sorted = [...rows].sort((a, b) => a.win - b.win);
  const [opp, setOpp] = useState(sorted[0]?.key ?? "");
  const name = rows.find((r) => r.key === opp)?.name ?? "";
  const [text, setText] = useState(() => planText(planFor(deck.guide, sorted[0]?.name ?? "")));
  const [res, setRes] = useState(null);
  const [pending, start] = useTransition();
  const pick = (key) => {
    setOpp(key);
    setRes(null);
    setText(planText(planFor(deck.guide, rows.find((r) => r.key === key)?.name ?? "")));
  };
  const run = () =>
    start(async () => {
      setRes(await testSideboardPlan(deck.id, opp, text));
    });
  return (
    <div className="plan-tester">
      <h3>Test a sideboard plan</h3>
      <p className="sub small">
        Pick an opponent and write the plan as <code>+2 Get Lost -2 Hop to It</code>. It starts from your sideboard guide&apos;s line for
        that opponent when there is one. The main deck and the boarded deck play the same 600 games, so the difference is fairer than two
        separate runs. A good plan usually keeps your threats and adds only cheap answers.
      </p>
      <div className="claude-line">
        <select value={opp} onChange={(e) => pick(e.target.value)} aria-label="Opponent">
          {sorted.map((r) => (
            <option key={r.key} value={r.key}>
              {r.name} ({pc(r.win)})
            </option>
          ))}
        </select>
      </div>
      <textarea
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={`No guide line for ${name}. Type a plan like +2 Get Lost -2 Hop to It`}
        aria-label="Sideboard plan"
        style={{ width: "100%" }}
      />
      <div className="claude-line">
        <button type="button" onClick={run} disabled={pending || !text.trim()}>
          {pending ? "Playing the games (about 10 seconds)…" : "Test this plan"}
        </button>
      </div>
      {res?.error && <p className="msg err">{res.error}</p>}
      {res?.after != null && (
        <p>
          Against {res.opponent}: main deck <b>{pc(res.before)}</b> → boarded <span className={`pill ${tone(res.after)}`}>{pc(res.after)}</span>{" "}
          <span className="sub small num">
            ({res.delta >= 0 ? "+" : ""}
            {Math.round(res.delta * 1000) / 10} points, ±{Math.round(res.se * 2000) / 10})
          </span>
          {Math.abs(res.delta) < 2 * res.se && <span className="sub small"> That&apos;s within noise: the plan barely changes the matchup.</span>}
          {res.delta <= -2 * res.se && <span className="sub small"> The plan makes this matchup worse. Try cutting fewer threats.</span>}
        </p>
      )}
    </div>
  );
}

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
      {res?.rows?.length > 0 && <PlanTester deck={deck} rows={res.rows} />}
    </section>
  );
}
