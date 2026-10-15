import { pct } from "@/lib/stats.mjs";

const ENTRY = {
  untapped: "Untapped",
  life: "Untapped for 2 life",
  early: "Untapped on turns 1–3",
  late: "Tapped on turns 1–2",
  tapped: "Always tapped",
  fetch: "Fetches a basic, tapped",
};
const PILL = { good: "good", warn: "warn", bad: "bad" };
const WORD = { good: "On target", warn: "Borderline", bad: "Short" };

/** The pre-test math: mana, curve, opening hands, interaction and sideboard plans. */
export default function PretestPanel({ report: r, error, open }) {
  if (!r) return null;
  const maxCurve = Math.max(1, ...r.curve.map((c) => c.n));
  const maxHand = Math.max(...r.hands.distribution);

  return (
    <details className="pretest" open={open}>
      <summary>
        <h2>Pre-test report</h2>
        <span className="sub small">The math to check before the first match</span>
      </summary>

      {error && <div className="banner err">{error}</div>}

      <ul className="flags">
        {r.flags.map((f) => (
          <li key={f.text} className={f.level}>
            <span className={`pill ${PILL[f.level]}`}>{f.level === "good" ? "OK" : f.level === "warn" ? "Check" : "Fix"}</span> {f.text}
          </li>
        ))}
      </ul>

      <div className="strip tight">
        <div className="stat">
          <span className="k">Lands</span>
          <span className="v">{r.lands}</span>
          <span className="n">{r.spells} spells · avg mana value {r.avgMV.toFixed(2)}</span>
        </div>
        <div className="stat">
          <span className="k">Creatures</span>
          <span className="v">{r.creatures}</span>
          <span className="n">{r.legendaryCreatures} legendary</span>
        </div>
        <div className="stat">
          <span className="k">Keepable land count</span>
          <span className="v">{pct(r.hands.p2to4)}</span>
          <span className="n">opening 7s with 2–4 lands</span>
        </div>
        <div className="stat">
          <span className="k">Removal</span>
          <span className="v">{r.interaction.count}</span>
          <span className="n">one by turn 3 in {pct(r.interaction.pT3)} of games</span>
        </div>
      </div>

      <div className="pt-grid">
        <section>
          <h3>Curve</h3>
          <div className="bars" role="img" aria-label={`Curve: ${r.curve.map((c) => `${c.n} at ${c.mv}`).join(", ")}`}>
            {r.curve.map((c) => (
              <div key={c.mv} className="vb">
                <span className="bn num">{c.n || ""}</span>
                <span className="bt">
                  <span className="bf" style={{ height: `${(100 * c.n) / maxCurve}%` }} />
                </span>
                <span className="bl">{c.mv}</span>
              </div>
            ))}
          </div>
          <p className="small sub">
            Spells by printed mana value. Lands left out.
            {r.reducers?.length > 0 && ` ${r.reducers.map((x) => x.name).join(", ")} usually cost much less than shown.`}
          </p>
        </section>

        <section>
          <h3>Lands in the opening 7</h3>
          <div className="bars" role="img" aria-label="Chance of each land count in the opening hand">
            {r.hands.distribution.map((p, k) => (
              <div key={k} className={`vb${k >= 2 && k <= 4 ? "" : " dim"}`}>
                <span className="bn num">{p >= 0.005 ? Math.round(100 * p) : ""}</span>
                <span className="bt">
                  <span className="bf" style={{ height: `${(100 * p) / maxHand}%` }} />
                </span>
                <span className="bl">{k}</span>
              </div>
            ))}
          </div>
          <p className="small sub">
            % of hands by land count. 3 lands by turn 3: {pct(r.hands.pT3)} · 4 by turn 4: {pct(r.hands.pT4)} · an untapped land on turn 1:{" "}
            {pct(r.hands.pUntappedT1)}.
          </p>
        </section>
      </div>

      <section>
        <h3>Colors</h3>
        <div className="tbl">
          <table>
            <thead>
              <tr>
                <th>Color</th>
                <th className="r">Sources</th>
                <th className="r">Cards</th>
                <th>Hardest to cast on curve</th>
                <th className="r">Chance</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {r.colors.map((c) => (
                <tr key={c.color}>
                  <td>{c.name}</td>
                  <td className="r num">
                    {c.sources}
                    {c.flex > 0 && <span className="sub small"> ({c.fixed} + {c.flex} flexible)</span>}
                  </td>
                  <td className="r num">{c.cards}</td>
                  <td>
                    {c.worst.name} <span className="sub small">· {c.worst.need} pip{c.worst.need > 1 ? "s" : ""} on turn {c.worst.turn}</span>
                  </td>
                  <td className="r num">{pct(c.worst.p)}</td>
                  <td>
                    <span className={`pill ${PILL[c.level]}`}>{WORD[c.level]}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h3>Lands</h3>
        <div className="tbl">
          <table>
            <thead>
              <tr>
                <th>Land</th>
                <th className="r">Copies</th>
                <th>Makes</th>
                <th>Enters</th>
              </tr>
            </thead>
            <tbody>
              {r.landList.map((l) => (
                <tr key={l.name}>
                  <td>{l.name}</td>
                  <td className="r num">{l.qty}</td>
                  <td>{l.flex ? "One color, chosen as it enters" : l.colors.join(" ") || "Colorless"}</td>
                  <td>{ENTRY[l.entry]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {r.interaction.cards.length > 0 && (
        <p className="small">
          <b>Removal found:</b> {r.interaction.cards.map((c) => `${c.qty} ${c.name}`).join(", ")}. One by turn 5: {pct(r.interaction.pT5)}.
        </p>
      )}

      {r.plans.length > 0 && (
        <section>
          <h3>Sideboard plans</h3>
          <div className="tbl">
            <table>
              <thead>
                <tr>
                  <th>Opponent</th>
                  <th className="r">In</th>
                  <th className="r">Out</th>
                  <th>Check</th>
                </tr>
              </thead>
              <tbody>
                {r.plans.map((p) => (
                  <tr key={p.opp}>
                    <td>{p.opp}</td>
                    <td className="r num">{p.nIn}</td>
                    <td className="r num">{p.nOut}</td>
                    <td>{p.problems.length ? <span className="pill bad">{p.problems.join("; ")}</span> : <span className="pill good">Balanced</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <p className="small sub">
        How this is worked out: exact hypergeometric odds for a {r.total}-card deck on the play, no mulligans. The color check is
        Frank Karsten&apos;s method: the chance of having enough sources of that color, given you&apos;ve hit your land drops; 90% is the
        target. Lands that make one chosen color count for every color. Removal is found by matching card text, so treat that count as
        an estimate. Card data from Scryfall.
      </p>
    </details>
  );
}
