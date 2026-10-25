"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { buildSeedDeck, lookupSeeds, saveSeedDeck } from "@/app/actions";
import { PasscodeRow, usePasscode } from "./usePasscode";
import { CardInfoProvider, CardName } from "./CardInfo";

const COLOR_NAMES = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green" };
const fmt = (d) => `${d > 0 ? "+" : d < 0 ? "−" : "±"}${Math.abs(d).toFixed(2)}`;

/** Seeds → the whole deck-graph method → a 60 you can save as a Testing deck. */
export default function SeedBuilder({ names, poolDate, writable }) {
  const router = useRouter();
  const pc = usePasscode();
  const [seeds, setSeeds] = useState([""]);
  const [info, setInfo] = useState(null);
  const [colors, setColors] = useState([]);
  const [needs, setNeeds] = useState([]);
  const [removal, setRemoval] = useState(4);
  const [twins, setTwins] = useState(false);
  const [refine, setRefine] = useState(true);
  const [result, setResult] = useState(null);
  const [name, setName] = useState("");
  const [msg, setMsg] = useState(null);
  const [pending, start] = useTransition();
  const [phase, setPhase] = useState(null);

  const clean = seeds.map((s) => s.trim()).filter(Boolean);
  const setSeed = (i, v) => {
    setInfo(null);
    setResult(null);
    setSeeds((s) => s.map((x, j) => (j === i ? v : x)));
  };

  const lookup = (e) => {
    e?.preventDefault();
    setMsg(null);
    setResult(null);
    setPhase("lookup");
    start(async () => {
      const r = await lookupSeeds(clean);
      setInfo(r);
      if (!r.error) {
        setColors(r.colors);
        setNeeds(r.needs);
      }
      setPhase(null);
    });
  };
  const build = () => {
    setMsg(null);
    setPhase("build");
    start(async () => {
      const r = await buildSeedDeck({ seeds: clean, colors, needs, removal, twins: twins ? 1 : 0, refine });
      setResult(r);
      if (!r.error && !name) setName(`${clean[0]} build`);
      setPhase(null);
    });
  };
  const save = (e) => {
    e.preventDefault();
    setMsg(null);
    setPhase("save");
    start(async () => {
      const r = await saveSeedDeck({ main: result.main, name, seeds: clean, needs, colors: result.colors, passcode: pc.passcode });
      setPhase(null);
      if (r.error) return setMsg({ err: true, text: r.error });
      pc.keep();
      router.push(`/decks/${r.id}?new=1`);
    });
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result.main);
      setMsg({ text: "List copied. Paste it into Arena: Decks → Import." });
    } catch {
      setMsg({ err: true, text: "Couldn't copy. Select the list instead." });
    }
  };
  const seedColors = new Set(info?.seeds?.flatMap((s) => s.colors) ?? []);
  const allRoles = info && !info.error ? [...info.needs, ...info.other.filter((x) => !info.needs.includes(x))] : [];

  return (
    <CardInfoProvider>
      <section>
        <h2>1 · Seeds</h2>
        <form onSubmit={lookup} className="seedform">
          <datalist id="pool-names">
            {names.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
          {seeds.map((s, i) => (
            <div key={i} className="seedrow">
              <label>
                Seed {i + 1}
                <input list="pool-names" value={s} onChange={(e) => setSeed(i, e.target.value)} placeholder="Start typing a card name" autoComplete="off" />
              </label>
              {seeds.length > 1 && (
                <button type="button" className="ghost" onClick={() => setSeeds((x) => x.filter((_, j) => j !== i))} aria-label={`Remove seed ${i + 1}`}>
                  ✕
                </button>
              )}
            </div>
          ))}
          <div className="claude-line">
            {seeds.length < 6 && (
              <button type="button" className="ghost" onClick={() => setSeeds((x) => [...x, ""])}>
                + Another seed
              </button>
            )}
            <button type="submit" disabled={!clean.length || pending}>
              {phase === "lookup" ? "Looking up…" : "Look up seeds"}
            </button>
          </div>
          <p className="sub small">Standard nonland cards (pool updated {poolDate}). One seed is enough; two that work together give the build a clearer direction.</p>
        </form>
        {info?.error && <p className="msg err">{info.error}</p>}
      </section>

      {info && !info.error && (
        <section>
          <h2>2 · What they need</h2>
          <ul className="seedinfo">
            {info.seeds.map((s) => (
              <li key={s.name}>
                <CardName name={s.name} /> <span className="sub small">MV {s.cmc}</span>
                <div>
                  {s.roles.map((r) => (
                    <span key={r.id + r.side} className={`chip${info.needs.includes(r.id) ? " on" : ""}`}>
                      {r.side === "Q" ? "uses" : "makes"} {info.names[r.id]}
                    </span>
                  ))}
                  {!s.roles.length && <span className="sub small">No roles found in its text. It will be built around on colors only.</span>}
                </div>
              </li>
            ))}
          </ul>
          <fieldset className="opts">
            <legend>Needs (count ×5)</legend>
            <p className="sub small">
              Ticked by default: roles where a seed is a payoff, unless 1 in 20 Standard cards is also a payoff there (then it says
              little), or, for a seed with no payoff role, the rare thing it makes. Change them if you know better.
            </p>
            <div className="checks">
              {allRoles.map((id) => (
                <label key={id} className="check">
                  <input type="checkbox" checked={needs.includes(id)} onChange={(e) => setNeeds((n) => (e.target.checked ? [...n, id] : n.filter((x) => x !== id)))} />
                  {info.names[id]}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="opts">
            <legend>Colors</legend>
            <div className="checks">
              {Object.entries(COLOR_NAMES).map(([c, n]) => (
                <label key={c} className="check">
                  <input
                    type="checkbox"
                    checked={colors.includes(c)}
                    disabled={seedColors.has(c)}
                    onChange={(e) => setColors((x) => (e.target.checked ? [...x, c] : x.filter((y) => y !== c)))}
                  />
                  {n}
                  {seedColors.has(c) ? " (seed)" : ""}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="opts">
            <legend>Options</legend>
            <div className="checks">
              <label>
                Interaction
                <select value={removal} onChange={(e) => setRemoval(Number(e.target.value))}>
                  <option value={0}>None</option>
                  <option value={4}>4 removal spells</option>
                  <option value={8}>8 removal spells</option>
                </select>
              </label>
              <label className="check">
                <input type="checkbox" checked={twins} onChange={(e) => setTwins(e.target.checked)} />
                Add a look-alike for each seed
              </label>
              <label className="check">
                <input type="checkbox" checked={refine} onChange={(e) => setRefine(e.target.checked)} />
                Refine with the goldfish
              </label>
            </div>
            <p className="sub small">
              The graph can&apos;t value removal (it has no synergy), so you choose how much. The goldfish step swaps in faster cards, but
              only when the gain is bigger than its noise.
            </p>
          </fieldset>
          <div className="claude-line">
            <button type="button" onClick={build} disabled={pending}>
              {phase === "build" ? "Building and playing games…" : result ? "Build again" : "Build the deck"}
            </button>
          </div>
        </section>
      )}

      {result?.error && <p className="msg err">{result.error}</p>}
      {result && !result.error && <Result r={result} onCopy={copy} />}

      {result && !result.error && (
        <section>
          <h2>4 · Save it</h2>
          <form onSubmit={save} className="grid">
            <label className="wide">
              Deck name
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
            </label>
            <PasscodeRow pc={pc} writable={writable} pending={phase === "save"} label="Save as a Testing deck" />
          </form>
          <p className="sub small">It opens with the pre-test report and the Roles panel, and goes to Claude for a review. Add a sideboard there.</p>
          {msg && <p className={msg.err ? "msg err" : "msg"}>{msg.text}</p>}
        </section>
      )}
    </CardInfoProvider>
  );
}

function Result({ r, onCopy }) {
  const rows = r.main.split("\n").map((l) => {
    const m = l.match(/^(\d+) (.+)$/);
    return { n: +m[1], name: m[2] };
  });
  const lands = new Set(r.lands.map((l) => l.name));
  const seeds = new Set(r.nonland.filter((x) => x.seed).map((x) => x.name));
  const inter = new Set(r.nonland.filter((x) => x.interaction).map((x) => x.name));
  const group = (f) => rows.filter(f);
  const kept = r.refineSteps.filter((s) => s.kept);
  const g = r.goldfish;
  return (
    <section>
      <h2>3 · The deck</h2>
      <div className="strip tight">
        <div className="stat">
          <span className="k">Lands</span>
          <span className="v num">{r.landCount}</span>
          <span className="n">average MV {r.avgMV}</span>
        </div>
        <div className="stat">
          <span className="k">Goldfish kill turn</span>
          <span className="v num">{(g.final ?? g.built).mean}</span>
          <span className="n">{g.final ? `${g.built.mean} before the swaps · ` : ""}{Math.round((g.final ?? g.built).byT6 * 100)}% by turn 6</span>
        </div>
        <div className="stat">
          <span className="k">Role graph</span>
          <span className="v num">{r.cohesion.pieces === 1 ? "1 piece" : `${r.cohesion.pieces} pieces`}</span>
          <span className="n">
            λ₂ {r.cohesion.lambda2}
            {r.cohesion.cuts.length ? ` · weak point: ${r.cohesion.cuts.join(", ")}` : ""}
            {r.cohesion.isolated.length ? ` · on its own: ${r.cohesion.isolated.join(", ")}` : ""}
          </span>
        </div>
      </div>

      <div className="cols3">
        {[
          ["Seeds", group((x) => seeds.has(x.name))],
          ["Built around them", group((x) => !seeds.has(x.name) && !inter.has(x.name) && !lands.has(x.name))],
          ["Interaction", group((x) => inter.has(x.name))],
          ["Lands", group((x) => lands.has(x.name))],
        ]
          .filter(([, xs]) => xs.length)
          .map(([h, xs]) => (
            <div key={h}>
              <h4>
                {h} <span className="sub small num">{xs.reduce((s, x) => s + x.n, 0)}</span>
              </h4>
              <ul className="members">
                {xs.map((x) => (
                  <li key={x.name}>
                    <span className="num">{x.n}</span> <CardName name={x.name} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
      </div>
      <div className="claude-line">
        <button type="button" className="ghost" onClick={onCopy}>
          Copy list for Arena
        </button>
      </div>

      <details className="more" open>
        <summary>How it was built</summary>
        <ol className="buildlog">
          {r.log.map((l) => (
            <li key={l.name}>
              <b>{{ seed: "Seed", twin: "Look-alike", must: "Must-have" }[l.step] ?? "Added"}</b> <CardName name={l.name} />
              {l.kept !== l.copies && <span className="sub small"> ({l.kept ? `trimmed to ${l.kept}` : "cut to fit 60"})</span>}
              {l.gain != null && <span className="sub small num"> +{l.gain}</span>}
              {l.why && <span className="sub small"> {l.why}</span>}
              {l.roles?.length > 0 && <span className="sub small"> · {l.roles.join(", ")}</span>}
              {l.conflicts?.length > 0 && <span className="msg err small"> · conflict: {l.conflicts.join("; ")}</span>}
            </li>
          ))}
          {r.nonland
            .filter((x) => x.interaction)
            .map((x) => (
              <li key={x.name}>
                <b>Interaction</b> <CardName name={x.name} /> <span className="sub small">cheapest removal in your colors</span>
              </li>
            ))}
          <li>
            <b>Mana</b> <span className="sub small">{r.landCount} lands from the curve (Frank Karsten&apos;s rule of thumb); duals that make only your colors, untapped first; basics by colored pips.</span>
          </li>
          {r.refineSteps.map((s) => (
            <li key={s.round}>
              <b>Goldfish round {s.round}</b>{" "}
              {s.kept ? (
                <>
                  <CardName name={s.in} /> in for <CardName name={s.out} />{" "}
                  <span className="sub small num">
                    {fmt(s.delta)} turns (± {(2 * s.se).toFixed(2)})
                  </span>
                </>
              ) : (
                <span className="sub small">no swap was faster by more than its noise, so it stopped.</span>
              )}
            </li>
          ))}
        </ol>
        {kept.length > 0 && <p className="sub small">The goldfish only measures speed against an opponent who does nothing; check each swap still fits the plan.</p>}
      </details>

      <details className="more">
        <summary>Roles in the final deck</summary>
        <div className="tbl">
          <table>
            <thead>
              <tr>
                <th>Role</th>
                <th className="r">Producers : payoffs</th>
                <th className="r">Best split</th>
                <th>Verdict</th>
              </tr>
            </thead>
            <tbody>
              {r.roles.map((l) => (
                <tr key={l.id}>
                  <td>{l.name}</td>
                  <td className="r num">
                    {l.producers}
                    {l.base ? ` + ${l.base} land drops` : ""} : {l.payoffs}
                    {l.both ? ` (+${l.both} both)` : ""}
                  </td>
                  <td className="r num">
                    {l.best.producers} : {l.best.payoffs}
                  </td>
                  <td>{l.verdict}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <details className="more">
        <summary>Look-alikes for each seed</summary>
        {Object.entries(r.twins).map(([s, ts]) => (
          <p key={s} className="small">
            <b>{s}:</b>{" "}
            {ts.map((t, i) => (
              <span key={t.name}>
                {i ? ", " : ""}
                <CardName name={t.name} /> <span className="sub num">({t.sim})</span>
              </span>
            ))}
          </p>
        ))}
        <p className="sub small">Similar rules text and roles. Good backups when a seed is legendary or you want more copies of its effect.</p>
      </details>
    </section>
  );
}
