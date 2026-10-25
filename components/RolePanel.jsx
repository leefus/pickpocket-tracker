"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { goldfishPicks, goldfishRole, saveSwapDeck } from "@/app/actions";
import { BASIC_LANDS, parseList } from "@/lib/decklist.mjs";
import { CardName } from "./CardInfo";

const SHOWN = 5; // roles shown open; the rest fold away
const TOP = 8; // candidates sent to the goldfish per role side

const fmtDelta = (d) => `${d > 0 ? "+" : d < 0 ? "−" : "±"}${Math.abs(d).toFixed(2)}`;
/** A paired difference only counts when it's outside two standard errors. */
const fmtGain = (g) => (g < 0 ? `−${Math.abs(g)}` : `+${g}`);
const verdictOf = (r) => (Math.abs(r.delta) < 2 * r.se ? "noise" : r.delta < 0 ? "faster" : "slower");
const toneOf = (v) => (v === "Balanced." ? "good" : v.startsWith("No producers") ? "bad" : "warn");

/**
 * Roles: the synergy graph grouped by job. Each role is one side of one auto-edge rule
 * (all its producers link to all its payoffs, so they're interchangeable there).
 * `roles` comes from lib/roles.mjs on the server.
 */
export default function RolePanel({ roles, deck, writable, pc }) {
  const router = useRouter();
  const [picks, setPicks] = useState([]); // [{in, out, role}]
  const [ranks, setRanks] = useState({}); // "layer:side" → result | {error} | "loading"
  const [test, setTest] = useState(null);
  const [name, setName] = useState("");
  const [msg, setMsg] = useState(null);
  const [pending, start] = useTransition();
  const [ranking, startRank] = useTransition();

  const deckCards = useMemo(() => roles?.nonland ?? parseList(deck?.main).cards.filter((c) => !BASIC_LANDS.has(c.name)).map((c) => c.name), [roles, deck?.main]);
  if (!roles) return null;
  const fed = roles.layers.filter((l) => l.F > 0);
  const unfed = roles.layers.filter((l) => l.F === 0);
  const open = fed.slice(0, SHOWN);
  const folded = fed.slice(SHOWN);

  const pick = (inn, out, role) => {
    setTest(null);
    setPicks((p) => (p.some((x) => x.in === inn) ? p : [...p, { in: inn, out, role }]));
  };
  const unpick = (inn) => {
    setTest(null);
    setPicks((p) => p.filter((x) => x.in !== inn));
  };
  const setOut = (inn, out) => {
    setTest(null);
    setPicks((p) => p.map((x) => (x.in === inn ? { ...x, out } : x)));
  };

  const rank = (layer, side) => {
    const key = `${layer.id}:${side}`;
    const members = (side === "P" ? layer.producers : layer.payoffs).map((m) => m.name).slice(0, 6);
    const candidates = layer.candidates[side].slice(0, TOP).map((c) => c.name);
    setRanks((r) => ({ ...r, [key]: "loading" }));
    startRank(async () => {
      const res = await goldfishRole(deck.id, { candidates, members });
      setRanks((r) => ({ ...r, [key]: res }));
    });
  };

  const runPicks = () =>
    start(async () => {
      setMsg(null);
      setTest(await goldfishPicks(deck.id, picks));
    });
  const save = () =>
    start(async () => {
      setMsg(null);
      const res = await saveSwapDeck(deck.id, picks, name, pc.passcode);
      if (res.error) return setMsg({ err: true, text: res.error });
      pc.keep();
      router.push(`/decks/${res.id}?new=1`);
    });
  const copy = async () => {
    const list = test?.list;
    if (!list) return;
    try {
      await navigator.clipboard.writeText(list);
      setMsg({ text: "New main deck copied." });
    } catch {
      setMsg({ err: true, text: "Couldn't copy; select the list below instead." });
    }
  };

  const Role = ({ layer }) => (
    <div className="role">
      <div className="rolehead">
        <b>{layer.name}</b>
        <span className="sub small">
          {layer.label} · counts {layer.unit}
        </span>
        <span className={`pill ${toneOf(layer.verdict)}`}>{layer.verdict}</span>
      </div>
      <SplitLine layer={layer} />
      <div className="rolecols">
        {["P", "Q"].map((side) => (
          <Side key={side} layer={layer} side={side} result={ranks[`${layer.id}:${side}`]} onRank={() => rank(layer, side)} busy={ranking} picks={picks} onPick={pick} />
        ))}
      </div>
    </div>
  );

  return (
    <section id="roles">
      <h2>Roles</h2>
      <p className="sub small">
        Your synergy graph, grouped by job. <b>Producers</b> make something (bodies, land drops, life loss); <b>payoffs</b> turn it into
        value. Cards on one side of a role are interchangeable as far as the graph knows, so the role&apos;s <i>size</i> is what matters. The
        best producers : payoffs split comes from the draw odds: you want one payoff seen by turn 4, and every producer after that is one
        more trigger. That usually means about 3 : 1.
      </p>
      <p className="sub small">
        Which card fills each slot is your call. <b>Graph gain</b> ranks candidates by how much they add across all your roles, so a card
        that does two jobs ranks higher. <b>Rank by goldfish</b> plays each one in your deck, against an opponent who does nothing, on the
        same shuffles as your current list. That measures speed only: removal and protection score zero there, so judge those yourself.
      </p>

      <div className="strip tight">
        <div className="stat">
          <span className="k">Main role</span>
          <span className="v">{fed[0]?.name ?? "—"}</span>
          <span className="n">{fed[0] ? fed[0].label : "no role with both producers and payoffs"}</span>
        </div>
        <div className="stat">
          <span className="k">Roles working</span>
          <span className="v num">{fed.length}</span>
          <span className="n">{unfed.length ? `${unfed.length} with payoffs but no producers` : "every payoff has producers"}</span>
        </div>
        <div className="stat">
          <span className="k">Candidate pool</span>
          <span className="v num">{roles.colors.join("") || "C"}</span>
          <span className="n">Standard nonland cards in your colors, MV ≤ 6 · updated {roles.poolDate}</span>
        </div>
      </div>

      {open.map((l) => (
        <Role key={l.id} layer={l} />
      ))}
      {folded.length > 0 && (
        <details className="more">
          <summary>{folded.length} smaller roles</summary>
          {folded.map((l) => (
            <Role key={l.id} layer={l} />
          ))}
        </details>
      )}
      {unfed.length > 0 && (
        <details className="more">
          <summary>{unfed.length} roles with payoffs but no producers</summary>
          <p className="sub small">Usually a side effect of a card&apos;s text, not a plan. If one of these is your plan, add producers for it.</p>
          {unfed.map((l) => (
            <Role key={l.id} layer={l} />
          ))}
        </details>
      )}

      <div className="tray">
        <h3>Your picks</h3>
        {!picks.length ? (
          <p className="sub small">Pick a candidate in any role. It takes the place (and the number of copies) of the card you choose.</p>
        ) : (
          <>
            <ul className="picks">
              {picks.map((p) => (
                <li key={p.in}>
                  <CardName name={p.in} /> <span className="sub">in for</span>{" "}
                  <select value={p.out} onChange={(e) => setOut(p.in, e.target.value)} aria-label={`Card ${p.in} replaces`}>
                    {deckCards.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>{" "}
                  <span className="sub small">({p.role})</span>{" "}
                  <button type="button" className="ghost" onClick={() => unpick(p.in)} aria-label={`Remove ${p.in}`}>
                    ✕
                  </button>
                </li>
              ))}
            </ul>
            <div className="claude-line">
              <button type="button" onClick={runPicks} disabled={pending}>
                {pending && !test ? "Playing 3,000 games…" : "Goldfish my picks"}
              </button>
              {test?.list && (
                <button type="button" className="ghost" onClick={copy}>
                  Copy new list
                </button>
              )}
            </div>
            {test?.error && <p className="msg err">{test.error}</p>}
            {test?.before && (
              <div className="strip tight">
                <div className="stat">
                  <span className="k">Kill turn now</span>
                  <span className="v num">{test.before.mean}</span>
                  <span className="n">{Math.round(test.before.byT6 * 100)}% by turn 6</span>
                </div>
                <div className="stat">
                  <span className="k">With your picks</span>
                  <span className="v num">{test.after.mean}</span>
                  <span className="n">{Math.round(test.after.byT6 * 100)}% by turn 6</span>
                </div>
                <div className="stat">
                  <span className="k">Change</span>
                  <span className="v num">{fmtDelta(test.delta)}</span>
                  <span className="n">
                    ± {(2 * test.se).toFixed(2)} turns ·{" "}
                    {verdictOf(test) === "noise" ? "within the noise" : verdictOf(test) === "faster" ? "really faster" : "really slower"}
                  </span>
                </div>
              </div>
            )}
            <div className="passrow">
              <label>
                New deck name
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder={`${deck.name} (role swaps)`} maxLength={100} />
              </label>
              <label>
                Passcode
                <input type="password" autoComplete="current-password" value={pc.passcode} onChange={(e) => pc.setPasscode(e.target.value)} disabled={!writable} />
              </label>
              <button type="button" onClick={save} disabled={!writable || pending || !pc.passcode}>
                Save as a new test deck
              </button>
            </div>
            <p className="sub small">Saving makes a separate Testing deck; this one doesn&apos;t change.</p>
            {msg && <p className={msg.err ? "msg err" : "msg"}>{msg.text}</p>}
          </>
        )}
      </div>
    </section>
  );
}

function SplitLine({ layer }) {
  const now = layer.producerCopies + layer.payoffCopies;
  const share = (x) => `${now ? (100 * x) / now : 0}%`;
  return (
    <div className="splitline small">
      <span>
        Producers <b className="num">{layer.producerCopies}</b> copies{layer.base ? ` + ${layer.base} land drops` : ""} : payoffs{" "}
        <b className="num">{layer.payoffCopies}</b>
        <span className="sub">
          {" "}
          · best for these {now}: {layer.split.producers} : {layer.split.payoffs}
        </span>
      </span>
      <div className="splitbar" aria-hidden="true">
        <i style={{ width: share(layer.producerCopies) }} />
        <s style={{ left: share(layer.split.producers) }} title="best split" />
      </div>
    </div>
  );
}

function Side({ layer, side, result, onRank, busy, picks, onPick }) {
  const members = side === "P" ? layer.producers : layer.payoffs;
  const cands = layer.candidates[side];
  const byIn = new Map(result && result.results ? result.results.map((r) => [r.in, r]) : []);
  const weakest = members[0]?.name;
  return (
    <div className="side">
      <h4>{side === "P" ? "Producers" : "Payoffs"}</h4>
      {members.length ? (
        <ul className="members">
          {members.map((m) => (
            <li key={m.name}>
              <span className="num">{m.copies}</span> <CardName name={m.name} />
              {m.both && <span className="chip">both sides</span>}
              <span className="sub small num" title="how much the deck's role score drops without it">
                {" "}
                worth {m.worth}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="sub small">None in the deck{layer.base ? " (your land drops still count)" : ""}.</p>
      )}
      {cands.length > 0 && (
        <>
          <div className="tbl">
            <table>
              <thead>
                <tr>
                  <th>Candidate</th>
                  <th className="r">MV</th>
                  <th className="r" title="how much it adds to the deck's role score, across every role">
                    Graph gain
                  </th>
                  {result?.results && <th className="r">Goldfish</th>}
                  <th />
                </tr>
              </thead>
              <tbody>
                {cands.map((c) => {
                  const g = byIn.get(c.name);
                  const v = g && verdictOf(g);
                  const picked = picks.some((p) => p.in === c.name);
                  return (
                    <tr key={c.name}>
                      <td>
                        <CardName name={c.name} />
                        {c.alsoIn.length > 0 && <span className="chip">also {c.alsoIn.join(", ")}</span>}
                      </td>
                      <td className="r num">{c.cmc}</td>
                      <td className="r num">{fmtGain(c.gain)}</td>
                      {result?.results && (
                        <td className="r small">
                          {g ? (
                            <span className={v === "faster" ? "good" : v === "slower" ? "bad" : "sub"} title={`for ${g.out}; ± ${(2 * g.se).toFixed(2)}`}>
                              <span className="num">{fmtDelta(g.delta)}</span> {v === "noise" ? "noise" : `for ${g.out}`}
                              {g.dead && " · does nothing here"}
                            </span>
                          ) : (
                            <span className="sub">—</span>
                          )}
                        </td>
                      )}
                      <td className="r">
                        <button type="button" className="ghost" disabled={picked} onClick={() => onPick(c.name, g?.out ?? weakest ?? layer.producers[0]?.name ?? layer.payoffs[0]?.name, layer.id)}>
                          {picked ? "Picked" : "Pick"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="claude-line">
            <button type="button" className="ghost" onClick={onRank} disabled={busy || !members.length}>
              {result === "loading" ? "Playing games…" : `Rank top ${Math.min(TOP, cands.length)} by goldfish`}
            </button>
            {result?.base && (
              <span className="sub small">
                Kill turn now {result.base.mean} · Δ = change in average kill turn over {result.games.toLocaleString()} games, negative is faster
              </span>
            )}
            {result?.error && <span className="msg err">{result.error}</span>}
          </div>
        </>
      )}
    </div>
  );
}
