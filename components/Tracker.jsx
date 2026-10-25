"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { addMatch, removeMatch, requestAnalysis } from "@/app/actions";
import { deadCardChoices, parseGuide, parseList } from "@/lib/decklist.mjs";
import { ARCHETYPES, COLORS, EVENTS, NOT_IN_META, colorCode } from "@/lib/meta.mjs";
import { opponentLabel, pct, summarize, won, worstFromGuide } from "@/lib/stats.mjs";
import { PasscodeRow, usePasscode } from "./usePasscode";
import GraphPanel from "./GraphPanel";
import PretestPanel from "./PretestPanel";
import PlanPanel from "./PlanPanel";
import JonesPanel from "./JonesPanel";
import RolePanel from "./RolePanel";
import MatchupPanel from "./MatchupPanel";
import { HeaderBrand } from "./Brand";
import { CardInfoProvider, CardName } from "./CardInfo";
import { splitCardList } from "@/lib/cardinfo.mjs";

const today = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
const rec = (r) => (r.n ? `${r.wins}–${r.losses}` : "—");
// A Notion date-only value ("2026-10-15") is a calendar day, not UTC midnight.
const fmtDate = (iso) => {
  if (!iso) return "";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00`) : new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};

export default function Tracker({ deck, decks, meta, matches, report = null, plan = null, jones = null, roles = null, opponents = [], cardError = null, cardInfo = {}, isNew = false, writable, connected, missing = [], loadError }) {
  const router = useRouter();
  const formRef = useRef(null);
  const pc = usePasscode();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState(null);
  const [badField, setBadField] = useState(null);
  const [opponent, setOpponent] = useState(meta[0] ?? NOT_IN_META);
  const [confirmId, setConfirmId] = useState(null);
  const [reqMsg, setReqMsg] = useState(null);

  const guide = useMemo(() => parseGuide(deck?.guide), [deck?.guide]);
  const s = useMemo(
    () =>
      summarize(matches, {
        meta,
        gateMatches: deck?.gateMatches ?? 30,
        gateRate: deck?.gateRate ?? 0.45,
        worst: worstFromGuide(guide),
        deckName: deck?.name ?? "this deck",
      }),
    [matches, meta, deck, guide],
  );
  const main = useMemo(() => parseList(deck?.main), [deck?.main]);
  const side = useMemo(() => parseList(deck?.side), [deck?.side]);
  const deadChoices = useMemo(() => deadCardChoices(deck?.main, deck?.side), [deck?.main, deck?.side]);
  const reviewIsStale = deck?.review && deck?.reviewedMatches != null && s.overall.n > deck.reviewedMatches;

  function onSubmit(e) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("passcode", pc.passcode);
    setMsg(null);
    setBadField(null);
    startTransition(async () => {
      const res = await addMatch(fd);
      if (res?.error) {
        setMsg({ text: res.error, err: true });
        setBadField(res.field ?? null);
        return;
      }
      pc.keep();
      setMsg({ text: "Match added." });
      const f = formRef.current;
      if (f) {
        f.querySelector("#f-notes").value = "";
        f.querySelector("#f-dead").value = "";
      }
      router.refresh();
    });
  }

  function onRequest() {
    setMsg(null);
    startTransition(async () => {
      const res = await requestAnalysis(deck.id, pc.passcode);
      if (res?.error) {
        setReqMsg({ text: res.error, err: true });
        return;
      }
      pc.keep();
      setReqMsg({ text: "Sent. Claude picks it up within about an hour." });
      router.refresh();
    });
  }

  function onRemove(id) {
    startTransition(async () => {
      const res = await removeMatch(id, pc.passcode);
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
    ["Matches logged", `${n} / ${deck?.gateMatches ?? 30}`, n >= (deck?.gateMatches ?? 30) ? "Gate reached" : `${(deck?.gateMatches ?? 30) - n} to the decision gate`],
    ["Game win rate", s.games.won + s.games.lost ? pct(s.games.won / (s.games.won + s.games.lost)) : "—", `${s.games.won}–${s.games.lost} in games`],
    ["On the play", pct(s.onPlay.rate), `${s.onPlay.n} matches`],
    ["On the draw", pct(s.onDraw.rate), `${s.onDraw.n} matches`],
  ];
  const errCls = (f) => (badField === f ? "field-err" : undefined);
  const offMeta = opponent === NOT_IN_META;

  return (
    <CardInfoProvider cards={cardInfo}>
    <div className="wrap">
      <header className="top">
        <div className="titles">
          <p className="crumb">
            <Link href="/">← All decks</Link>
          </p>
          <p className="eyebrow">MTG Standard Deck Stats Tracker</p>
          <h1>{deck?.name ?? "No deck yet"}</h1>
          {deck && (
            <p className="sub">
              {[deck.format, deck.archetype, colorCode(deck.colors), deck.status].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
        <nav className="decknav" aria-label="Decks">
          {decks.length > 1 && (
            <label>
              Deck
              <select id="deck-switch" value={deck?.id ?? ""} onChange={(e) => router.push(`/decks/${e.target.value}`)}>
                {decks.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                    {d.status === "Retired" ? " (retired)" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          <Link className="btnlink" href="/decks/new">
            Add a deck
          </Link>
          <Link className="btnlink" href="/build">
            Build from seeds
          </Link>
        </nav>
        <HeaderBrand />
      </header>

      {!connected && (
        <div className="banner">
          Not connected to Notion yet. This deployment can&apos;t see: <b>{missing.join(", ")}</b>. Add {missing.length > 1 ? "them" : "it"} in
          Vercel (Settings → Environment Variables, with Production ticked), then redeploy. <a href="/api/status">Check setup</a>
        </div>
      )}
      {loadError && <div className="banner err">{loadError}</div>}
      {connected && !deck && !loadError && (
        <div className="banner">
          No decks yet. <Link href="/decks/new">Add your first deck</Link> to start logging matches.
        </div>
      )}

      {deck && isNew && (
        <div className="banner good">
          <b>Deck saved and sent to Claude.</b> The pre-test report below is ready now. Claude&apos;s written review and synergy edges arrive
          within about an hour; this page shows them when they do.
        </div>
      )}

      {deck && (
        <>
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

          <section className="review">
            <h2>Claude&apos;s deck notes</h2>
            {deck.review ? (
              <>
                <p className="meta-line">
                  Reviewed {fmtDate(deck.reviewedAt)}
                  {deck.reviewedMatches != null && ` after ${deck.reviewedMatches} matches`}
                  {reviewIsStale && ` · ${n - deck.reviewedMatches} new since then`}
                </p>
                <div className="review-body">{deck.review}</div>
              </>
            ) : (
              <p className="msg">
                No review yet. Claude writes a pre-test review when a deck is added, then reads its matches once a day and writes
                adjustment notes here.
              </p>
            )}
            <div className="claude-line">
              {deck.analysisRequested ? (
                <span className="pill warn">Sent to Claude {fmtDate(deck.requestedAt)} · review due within about an hour</span>
              ) : (
                <>
                  <button type="button" className="ghost" onClick={onRequest} disabled={!writable || pending || !pc.passcode}>
                    Ask Claude to re-check this deck
                  </button>
                  {writable && !pc.passcode && <span>Enter your passcode in the match form first.</span>}
                </>
              )}
              {reqMsg && <span className={reqMsg.err ? "msg err" : "msg"}>{reqMsg.text}</span>}
            </div>
          </section>

          <PretestPanel report={report} error={cardError} open={isNew || n === 0} />

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
                    <tr key={o.group} className={o.offMeta ? "offmeta" : undefined}>
                      <td>{o.group}</td>
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

          <GraphPanel deck={deck} matches={matches} />
          <MatchupPanel deck={deck} logged={Object.fromEntries(s.byOpponent.filter((o) => o.n).map((o) => [o.group, rec(o)]))} />
          <RolePanel roles={roles} deck={deck} writable={writable} pc={pc} opponents={opponents} />

          <PlanPanel plan={plan} deckName={deck.name} />
          <JonesPanel jones={jones} deck={deck} />

          <section id="log">
            <h2>Log a match</h2>
            <form id="f" ref={formRef} onSubmit={onSubmit}>
              <input type="hidden" name="deckId" value={deck.id} />
              <label>
                Date
                <input id="f-date" name="date" type="date" required defaultValue={today()} className={errCls("date")} />
              </label>
              <label>
                Opponent
                <select id="f-opp" name="opponent" value={opponent} onChange={(e) => setOpponent(e.target.value)} className={errCls("opponent")}>
                  <optgroup label="Current meta">
                    {meta.map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </optgroup>
                  <option value={NOT_IN_META}>Not in meta…</option>
                </select>
              </label>
              {offMeta && (
                <>
                  <label>
                    Basic type
                    <select id="f-arch" name="opponentArchetype" defaultValue="" required className={errCls("opponentArchetype")}>
                      <option value="" disabled>
                        Pick one
                      </option>
                      {ARCHETYPES.map((a) => (
                        <option key={a}>{a}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Deck name (optional)
                    <input id="f-oname" name="opponentName" type="text" placeholder="e.g. Rakdos Lizards" />
                  </label>
                  <fieldset className="wide colors">
                    <legend>Their colors</legend>
                    {COLORS.map((c) => (
                      <label key={c} className="check">
                        <input type="checkbox" name="opponentColors" value={c} /> {c}
                      </label>
                    ))}
                  </fieldset>
                </>
              )}
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
                  {deadChoices.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label className="wide">
                Notes
                <textarea id="f-notes" name="notes" rows={2} placeholder="What decided it? What did you board in and out?" />
              </label>
              <PasscodeRow pc={pc} writable={writable} pending={pending} label="Add match" invalid={badField === "passcode"} />
              {(msg || !writable) && (
                <p className={`msg wide${msg?.err ? " err" : ""}`} role="status">
                  {msg ? msg.text : "Saving is off until the Notion variables and TRACKER_PASSCODE are set in Vercel."}
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
                        <td><CardName name={d.card} /></td>
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
                  {matches.length ? (
                    matches.map((m) => (
                      <tr key={m.id}>
                        <td className="num">{m.date}</td>
                        <td>{opponentLabel(m)}</td>
                        <td>{m.playDraw ?? "—"}</td>
                        <td className="r num">
                          {m.gamesWon}–{m.gamesLost}
                        </td>
                        <td className={won(m) ? "res-w" : "res-l"}>{won(m) ? "Win" : "Loss"}</td>
                        <td>{m.deadCard ? <CardName name={m.deadCard} /> : "—"}</td>
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
                        No matches for {deck.name} yet. Add your first one above; it saves to your Notion match log.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <details>
            <summary>The {main.count + side.count} and sideboard guide</summary>
            <div className="cols">
              <div>
                <h3>Main deck ({main.count})</h3>
                <ul>
                  {main.cards.map((c) => (
                    <li key={c.name}>
                      <span>{c.qty}</span>
                      <CardName name={c.name} />
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3>Sideboard ({side.count})</h3>
                <ul>
                  {side.cards.map((c) => (
                    <li key={c.name}>
                      <span>{c.qty}</span>
                      <CardName name={c.name} />
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            {guide.length > 0 && (
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
                    {guide.map((g) => (
                      <tr key={g.opp}>
                        <td>{g.opp}</td>
                        <td><CardList text={g.ins} /></td>
                        <td><CardList text={g.outs} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {deck.notes && <p className="msg" style={{ marginTop: 12 }}>{deck.notes}</p>}
          </details>
        </>
      )}
    </div>
    </CardInfoProvider>
  );
}

/** "2 Kain, Traitorous Dragoon, 1 Liliana the Faultless" as tappable card names. */
function CardList({ text }) {
  const items = splitCardList(text);
  if (!items.length) return <>{text}</>;
  return items.map((it, i) => (
    <span key={i}>
      {i > 0 && ", "}
      {it.qty != null && `${it.qty} `}
      <CardName name={it.name} />
    </span>
  ));
}
