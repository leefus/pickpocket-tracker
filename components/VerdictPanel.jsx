"use client";

import { useState, useTransition } from "react";
import { cardKnockouts, cardVerdictSetup, swapSearchConfirm, swapSearchRound, swapSearchStart } from "@/app/actions";
import { verdictOf } from "@/lib/verdict.mjs";

const TONE = { strong: "good", worst: "good", engine: "warn", role: "", blind: "warn", cut: "bad" };
const sign = (x) => `${x >= 0 ? "+" : ""}${x}`;

/**
 * Card verdicts (own value vs partner value) and a replacement search for the weakest cards.
 * Own value: the duel sim's in-silico knockout (every copy becomes a vanilla body of the same mana value).
 * Partner value: betweenness centrality in the reviewed synergy graph.
 */
export default function VerdictPanel({ deck }) {
  const [rows, setRows] = useState(null);
  const [meta, setMeta] = useState(null);
  const [msg, setMsg] = useState(null);
  const [progress, setProgress] = useState("");
  const [picked, setPicked] = useState([]);
  const [search, setSearch] = useState(null);
  const [pending, start] = useTransition();
  const [mode, setMode] = useState(null);

  const judge = () =>
    start(async () => {
      setMode("judge");
      setMsg(null);
      setSearch(null);
      setProgress("Reading the synergy graph…");
      const s = await cardVerdictSetup(deck.id);
      if (s.error) return setMsg(s.error);
      setMeta(s);
      const out = s.cards.map((c) => ({ ...c }));
      for (let i = 0; i < out.length; i += 2) {
        setProgress(`Knocking out cards ${i + 1}–${Math.min(i + 2, out.length)} of ${out.length}…`);
        const k = await cardKnockouts(deck.id, out.slice(i, i + 2).map((c) => c.name));
        if (k.error) return setMsg(k.error);
        for (const r of k.rows) Object.assign(out.find((c) => c.name === r.name), r, { worstName: k.worstName });
        setMeta({ ...s, worstName: k.worstName, worstWin: k.worstWin });
        setRows(out.map((c) => ({ ...c })));
      }
      const judged = out.map((c) => ({ ...c, verdict: verdictOf({ ...c, maxDegree: s.maxDegree }) }));
      setRows(judged);
      const pickable = judged.filter((c) => c.verdict.key === "cut" || (c.verdict.key === "role" && c.textSeen >= 0.8)).sort((a, b) => a.own - b.own);
      setPicked(pickable.slice(0, 2).map((c) => c.name));
      setProgress("");
    });

  const toggle = (name) => setPicked((p) => (p.includes(name) ? p.filter((x) => x !== name) : [...p, name].slice(-2)));

  const find = () =>
    start(async () => {
      setMode("find");
      setMsg(null);
      setSearch(null);
      setProgress("Choosing candidates…");
      let st = await swapSearchStart(deck.id, picked);
      if (st.error) return setMsg(st.error);
      while (st.stage === "rounds") {
        setProgress(`Round ${st.round + 1}: ${st.cands.length} candidates, ${st.games} games per meta deck…`);
        st = await swapSearchRound(deck.id, st);
        if (st.error) return setMsg(st.error);
        setSearch({ ...st });
      }
      const checked = [];
      for (const c of st.cands) {
        setProgress(`Replaying “${c.label}” on fresh games…`);
        const r = await swapSearchConfirm(deck.id, c);
        if (!r.error) checked.push(r);
      }
      setSearch({ ...st, checked });
      setProgress("");
    });

  return (
    <section id="verdicts">
      <h2>Card verdicts</h2>
      <p className="sub small">
        Two numbers per card. <b>Own value</b>: the sim replaces every copy with a plain creature of the same mana value and replays the same
        games against the five meta decks; the drop in win rate is what the card adds by itself. <b>Partner value</b>: how much of your
        synergy graph runs through the card (betweenness centrality). A card high on partner value and low on own value is an{" "}
        <b>engine</b>: it matters only next to its partners, which the sim mostly can&apos;t see.
      </p>
      <div className="claude-line">
        <button type="button" onClick={judge} disabled={pending}>
          {pending && mode === "judge" ? progress || "Working…" : rows ? "Judge again" : "Judge each card (a minute or two)"}
        </button>
      </div>
      {msg && <p className="msg err">{msg}</p>}
      {rows && (
        <div className="tbl">
          <table>
            <thead>
              <tr>
                <th>Card</th>
                <th className="r" title="win-rate points the card adds over a plain body of the same mana value; ± is two standard errors">Own value</th>
                <th className="r" title="own value against your worst meta matchup in these games">{meta?.worstName ? `vs ${meta.worstName.split(" ").slice(-1)[0]}` : "Worst matchup"}</th>
                <th className="r" title="betweenness centrality in the synergy graph, 0–1">Partner value</th>
                <th className="r">Partners</th>
                <th className="r" title="share of the card's text the sim understands">Sim reads</th>
                <th>Verdict</th>
                <th title="pick up to two cards to try replacing">Try replacing</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.name}>
                  <td>
                    {c.copies} {c.name}
                  </td>
                  <td className="r num">{c.own == null ? "…" : <>{sign(c.own)} <span className="sub small">±{(2 * c.ownSe).toFixed(1)}</span></>}</td>
                  <td className="r num">{c.worst == null ? "…" : sign(c.worst)}</td>
                  <td className="r num">{c.partner.toFixed(2)}</td>
                  <td className="r num">{c.degree}</td>
                  <td className="r num">{Math.round(c.textSeen * 100)}%</td>
                  <td>{c.verdict ? <span className={`pill ${TONE[c.verdict.key]}`} title={c.verdict.note}>{c.verdict.label}</span> : "…"}</td>
                  <td>
                    <input type="checkbox" checked={picked.includes(c.name)} onChange={() => toggle(c.name)} disabled={pending || !c.verdict} aria-label={`Try replacing ${c.name}`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows?.every((c) => c.verdict) && (
        <>
          <p className="sub small">
            {meta?.worstName && <>Your worst meta matchup in these games is {meta.worstName} ({meta.worstWin}%), so each card&apos;s value there gets its own column. </>}
            Hover a verdict for what to do with it. Own value is noisy: anything inside its ± is a tie with a plain body. Engines and cards the
            sim can&apos;t read are judged by logged games, not by this table.
          </p>
          <h3>Find replacements</h3>
          <p className="sub small">
            Tries the best cheap answers and the most efficient creatures in your colors in place of the ticked cards, one at a time and both
            at once. Each round plays every candidate on the same games, and the better half moves on with twice the games. The winners are
            then replayed on fresh games: a pick that only won on lucky draws shrinks or disappears there.
          </p>
          <div className="claude-line">
            <button type="button" onClick={find} disabled={pending || !picked.length}>
              {pending && mode === "find" ? progress || "Working…" : picked.length ? `Find replacements for ${picked.join(" and ")}` : "Tick a card to replace"}
            </button>
          </div>
        </>
      )}
      {search?.history?.length > 0 && (
        <details open={!search.checked}>
          <summary>Rounds ({search.history.length})</summary>
          {search.history.map((h) => (
            <p key={h.round} className="small">
              Round {h.round + 1} ({h.games} games per deck): {h.scored.slice(0, 6).map((x) => `${x.label} ${sign(x.delta)}`).join("; ")}
              {h.scored.length > 6 ? "; …" : ""}
            </p>
          ))}
        </details>
      )}
      {search?.checked && (
        <div className="tbl">
          <table>
            <thead>
              <tr>
                <th>Finalist</th>
                <th className="r">In the rounds</th>
                <th className="r">On fresh games</th>
                <th>Verdict</th>
              </tr>
            </thead>
            <tbody>
              {search.checked.map((c) => (
                <tr key={c.label}>
                  <td>{c.label}</td>
                  <td className="r num">{c.searchDelta == null ? "—" : sign(c.searchDelta)}</td>
                  <td className="r num">
                    {sign(c.delta)} <span className="sub small">±{(2 * c.se).toFixed(1)}</span>
                  </td>
                  <td>
                    <span className={`pill ${c.verdict === "holds" ? "good" : c.verdict === "close" ? "warn" : "bad"}`}>
                      {c.verdict === "holds" ? "Holds up" : c.verdict === "close" ? "Too close to call" : "Didn't hold up"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="sub small">
            Points are win rate averaged over the five meta decks. &ldquo;Holds up&rdquo; means the gain on fresh games is more than twice its
            standard error; &ldquo;too close to call&rdquo; means it&apos;s positive but could be noise. To make a change, use the Roles panel or ask Claude, so the synergy edges and notes get updated too.
          </p>
        </div>
      )}
    </section>
  );
}
