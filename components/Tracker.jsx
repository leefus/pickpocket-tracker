"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addMatch, removeMatch } from "@/app/actions";
import { DEAD_CARD_CHOICES, EVENTS, GUIDE, MAIN, OPPONENTS, SIDEBOARD } from "@/lib/deck.mjs";
import { GATE_MATCHES, oppName, pct, summarize, won } from "@/lib/stats.mjs";

const PASS_KEY = "pickpocket-passcode";
const today = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
const rec = (r) => (r.n ? `${r.wins}–${r.losses}` : "—");

export default function Tracker({ matches, writable, connected, loadError }) {
  const router = useRouter();
  const formRef = useRef(null);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState(null);
  const [badField, setBadField] = useState(null);
  const [opponent, setOpponent] = useState(OPPONENTS[0]);
  const [passcode, setPasscode] = useState("");
  const [remember, setRemember] = useState(true);
  const [confirmId, setConfirmId] = useState(null);

  // A remembered passcode is a per-device convenience; the server still checks it.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(PASS_KEY);
      if (saved) setPasscode(saved);
    } catch {}
  }, []);

  const s = useMemo(() => summarize(matches), [matches]);
  const history = useMemo(
    () => [...matches].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || (b.createdTime ?? "").localeCompare(a.createdTime ?? "")),
    [matches],
  );

  const keepPasscode = () => {
    try {
      if (remember) localStorage.setItem(PASS_KEY, passcode);
      else localStorage.removeItem(PASS_KEY);
    } catch {}
  };

  function onSubmit(e) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("passcode", passcode);
    setMsg(null);
    setBadField(null);
    startTransition(async () => {
      const res = await addMatch(fd);
      if (res?.error) {
        setMsg({ text: res.error, err: true });
        setBadField(res.field ?? null);
        return;
      }
      keepPasscode();
      setMsg({ text: "Match added." });
      formRef.current?.querySelector("#f-notes") && (formRef.current.querySelector("#f-notes").value = "");
      formRef.current?.querySelector("#f-dead") && (formRef.current.querySelector("#f-dead").value = "");
      router.refresh();
    });
  }

  function onRemove(id) {
    startTransition(async () => {
      const res = await removeMatch(id, passcode);
      setConfirmId(null);
      if (res?.error) {
        setMsg({ text: res.error, err: true });
        return;
      }
      setMsg({ text: "Match removed. It's in Notion's trash if you need it back." });
      router.refresh();
    });
  }

  const n = s.overall.n;
  const [lo, hi] = s.interval;
  const stats = [
    ["Match win rate", n ? pct(s.overall.rate) : "—", n ? `${rec(s.overall)} · 95% range ${pct(lo)}–${pct(hi)}` : "No matches yet"],
    ["Matches logged", `${n} / ${GATE_MATCHES}`, n >= GATE_MATCHES ? "Gate reached" : `${GATE_MATCHES - n} to the decision gate`],
    ["Game win rate", s.games.won + s.games.lost ? pct(s.games.won / (s.games.won + s.games.lost)) : "—", `${s.games.won}–${s.games.lost} in games`],
    ["On the play", pct(s.onPlay.rate), `${s.onPlay.n} matches`],
    ["On the draw", pct(s.onDraw.rate), `${s.onDraw.n} matches`],
  ];
  const errCls = (f) => (badField === f ? "field-err" : undefined);

  return (
    <div className="wrap">
      <header>
        <h1>Orzhov Pickpocket · Match Log</h1>
        <p className="sub">
          Log every Bo3 match. The page tracks match win rate by opponent and by play/draw, and checks the testing gate: under 45% after{" "}
          {GATE_MATCHES} matches means switching to stock Orzhov Life Gain plus Lich&apos;s Relic and Bitter Triumph.
        </p>
      </header>

      {!connected && (
        <div className="banner">Not connected to Notion yet. Add NOTION_TOKEN and NOTION_DATA_SOURCE_ID in Vercel, then redeploy.</div>
      )}
      {loadError && <div className="banner err">{loadError}</div>}

      <div className="strip">
        {stats.map(([k, v, sub]) => (
          <div className="stat" key={k}>
            <span className="k">{k}</span>
            <span className="v">{v}</span>
            <span className="n">{sub}</span>
          </div>
        ))}
      </div>

      <div className={`gate ${s.gate.tone}`}>
        <b>{s.gate.head}</b> {s.gate.body}
      </div>

      <section>
        <h2>By opponent</h2>
        <div className="tbl">
          <table>
            <thead>
              <tr>
                <th>Opponent</th>
                <th className="r">Matches</th>
                <th className="r">Record</th>
                <th className="r">Win %</th>
                <th>On play</th>
                <th>On draw</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {s.byOpponent.map((o) => (
                <tr key={o.opp}>
                  <td>{o.opp}</td>
                  <td className="r num">{o.n}</td>
                  <td className="r num">{rec(o)}</td>
                  <td className="r">
                    {o.n ? (
                      <>
                        <span className="num">{pct(o.rate)}</span>
                        <div className="bar" title={pct(o.rate)}>
                          <i style={{ width: `${o.rate * 100}%` }} />
                        </div>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="num">{rec(o.play)}</td>
                  <td className="num">{rec(o.draw)}</td>
                  <td>
                    <span className={`pill ${o.status.tone}`}>{o.status.label}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2>Log a match</h2>
        <form id="f" ref={formRef} onSubmit={onSubmit}>
          <label>
            Date
            <input id="f-date" name="date" type="date" required defaultValue={today()} className={errCls("date")} />
          </label>
          <label>
            Opponent
            <select id="f-opp" name="opponent" value={opponent} onChange={(e) => setOpponent(e.target.value)} className={errCls("opponent")}>
              {OPPONENTS.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </label>
          <label hidden={opponent !== "Other"}>
            Other deck
            <input id="f-other" name="otherDeck" type="text" placeholder="e.g. Rakdos Lizards" />
          </label>
          <label>
            Play / draw
            <select id="f-pd" name="playDraw" defaultValue="Play" className={errCls("playDraw")}>
              <option value="Play">On the play</option>
              <option value="Draw">On the draw</option>
            </select>
          </label>
          <label>
            Games won
            <select id="f-gw" name="gamesWon" defaultValue="2" className={errCls("gamesWon")}>
              <option>0</option>
              <option>1</option>
              <option>2</option>
            </select>
          </label>
          <label>
            Games lost
            <select id="f-gl" name="gamesLost" defaultValue="0" className={errCls("gamesWon")}>
              <option>0</option>
              <option>1</option>
              <option>2</option>
            </select>
          </label>
          <label>
            Event
            <select id="f-ev" name="event" defaultValue={EVENTS[0]}>
              {EVENTS.map((e) => (
                <option key={e}>{e}</option>
              ))}
            </select>
          </label>
          <label>
            Dead card
            <select id="f-dead" name="deadCard" defaultValue="">
              <option value="">None</option>
              {DEAD_CARD_CHOICES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="wide">
            Notes
            <textarea id="f-notes" name="notes" rows={2} placeholder="What decided it? What did you board in and out?" />
          </label>
          <div className="wide passrow">
            <label>
              Passcode
              <input
                id="f-pass"
                type="password"
                autoComplete="current-password"
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                className={errCls("passcode")}
                disabled={!writable}
              />
            </label>
            <label className="check">
              <input id="f-remember" type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              Remember on this device
            </label>
            <button type="submit" id="f-btn" disabled={!writable || pending}>
              {pending ? "Saving…" : "Add match"}
            </button>
          </div>
          {(msg || !writable) && (
            <p className={`msg wide${msg?.err ? " err" : ""}`} role="status">
              {msg ? msg.text : "Saving is off until NOTION_TOKEN and TRACKER_PASSCODE are set in Vercel."}
            </p>
          )}
        </form>
      </section>

      <section>
        <h2>Dead cards</h2>
        <div className="tbl">
          <table>
            <thead>
              <tr>
                <th>Card</th>
                <th className="r">Times flagged</th>
                <th className="r">Share of matches</th>
              </tr>
            </thead>
            <tbody>
              {s.deadCards.length ? (
                s.deadCards.map((d) => (
                  <tr key={d.card}>
                    <td>{d.card}</td>
                    <td className="r num">{d.count}</td>
                    <td className="r num">{pct(d.share)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={3} className="empty">
                    No dead cards flagged yet. Pick one in the form when a card did nothing.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2>Match history</h2>
        <div className="tbl">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Opponent</th>
                <th>Play/draw</th>
                <th className="r">Games</th>
                <th>Result</th>
                <th>Dead card</th>
                <th>Notes</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {history.length ? (
                history.map((m) => (
                  <tr key={m.id}>
                    <td className="num">{m.date}</td>
                    <td>{oppName(m)}</td>
                    <td>{m.playDraw ?? "—"}</td>
                    <td className="r num">
                      {m.gamesWon}–{m.gamesLost}
                    </td>
                    <td className={won(m) ? "res-w" : "res-l"}>{won(m) ? "Win" : "Loss"}</td>
                    <td>{m.deadCard ?? "—"}</td>
                    <td>{m.notes ?? ""}</td>
                    <td>
                      {writable &&
                        (confirmId === m.id ? (
                          <>
                            <button className="danger" disabled={pending} onClick={() => onRemove(m.id)}>
                              Remove
                            </button>{" "}
                            <button className="ghost" onClick={() => setConfirmId(null)}>
                              Keep
                            </button>
                          </>
                        ) : (
                          <button className="ghost" onClick={() => setConfirmId(m.id)}>
                            Remove
                          </button>
                        ))}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} className="empty">
                    No matches yet. Add your first one above; it saves to your Notion match log.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <details>
        <summary>The 75 and sideboard guide</summary>
        <div className="cols">
          {MAIN.map((sec) => (
            <div key={sec.heading}>
              <h3>{sec.heading}</h3>
              <ul>
                {sec.cards.map(([q, c]) => (
                  <li key={c}>
                    <span>{q}</span>
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div>
            <h3>Sideboard (15)</h3>
            <ul>
              {SIDEBOARD.map(([q, c]) => (
                <li key={c}>
                  <span>{q}</span>
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="tbl" style={{ marginTop: 16 }}>
          <table>
            <thead>
              <tr>
                <th>Opponent</th>
                <th>In</th>
                <th>Out</th>
              </tr>
            </thead>
            <tbody>
              {GUIDE.map(([o, i, out]) => (
                <tr key={o}>
                  <td>{o}</td>
                  <td>{i}</td>
                  <td>{out}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
