import { KILL_EQUIV, RESOURCE_AXES, WIN_AXES } from "@/lib/axes.mjs";

const pc = (x) => `${Math.round(100 * x)}%`;
const COST_WORD = { life: "life", discard: "a discard", sacrifice: "a sacrifice" };
const fmtCost = (c) => (c.kind === "life" ? `${c.amount} life` : c.kind === "discard" ? `discard ${c.amount}` : `sacrifice ${c.amount}`);

/**
 * Plan profile: what the deck pushes (win axes and resources), how hard each other
 * deck in the tracker pushes back, and which of this deck's costs are worth paying where.
 * `plan` = { profile, field: [{name, win, resources}], pressure: {deckName: {life,…}}, harm: [...] }
 */
export default function PlanPanel({ plan, deckName }) {
  if (!plan) return null;
  const { profile, field, pressure, harm } = plan;
  const maxWin = Object.fromEntries(WIN_AXES.map((a) => [a.id, Math.max(1e-9, ...field.map((f) => f.win.find((w) => w.id === a.id).kills))]));
  const maxRes = Object.fromEntries(RESOURCE_AXES.map((a) => [a.id, Math.max(1e-9, ...field.map((f) => f.resources.find((r) => r.id === a.id).units))]));
  const mainAxis = WIN_AXES.find((a) => a.id === profile.main);
  const opponents = Object.entries(pressure).filter(([n]) => n !== deckName);
  const fuelCards = profile.cards.filter((c) => c.costs.some((x) => x.fuel));

  return (
    <section>
      <h2>Plan profile</h2>
      <p className="sub small">
        What each card does on seven axes: what it gives you plus what it takes from them, minus what it costs you. A card that does both
        (drain 1: you gain 1, they lose 1) counts both halves, so it scores double without a special bonus.
      </p>

      <div className="strip tight">
        <div className="stat">
          <span className="k">Wins on</span>
          <span className="v">{mainAxis?.label ?? "—"}</span>
          <span className="n">{profile.focus ? `${pc(profile.focus)} of its reach is on this axis` : "no win axis found"}</span>
        </div>
        <div className="stat">
          <span className="k">Turns into fuel</span>
          <span className="v">{profile.fuel.length ? profile.fuel.join(", ") : "—"}</span>
          <span className="n">{profile.fuel.length ? "costs this deck pays off, so they cost nothing" : "no cost the deck pays off"}</span>
        </div>
      </div>

      <div className="pt-grid">
        <div>
          <h3 className="axis-h">Win axes</h3>
          <ul className="axes">
            {profile.win.map((w) => (
              <li key={w.id}>
                <span className="al">{w.label}</span>
                <span className="ab">
                  <i style={{ width: `${Math.max(0, (100 * w.kills) / maxWin[w.id])}%` }} />
                </span>
                <span className="av num">{w.kills > 0 ? `${w.kills.toFixed(2)} kills` : "—"}</span>
              </li>
            ))}
          </ul>
          <p className="small sub">
            Reach toward a kill if every card in the 60 connects once (life ÷ 20, poison ÷ 10, mill ÷ 53). Bars compare with the other
            decks in your tracker.
          </p>
        </div>
        <div>
          <h3 className="axis-h">Resources</h3>
          <ul className="axes">
            {profile.resources.map((r) => (
              <li key={r.id}>
                <span className="al">{r.label}</span>
                <span className="ab">
                  <i style={{ width: `${Math.max(0, (100 * r.units) / maxRes[r.id])}%` }} />
                </span>
                <span className="av num">{r.units.toFixed(1)}</span>
              </li>
            ))}
          </ul>
          <p className="small sub">Cards drawn or taken, creatures made or removed, mana and tempo, summed over the 60.</p>
        </div>
      </div>

      {opponents.length > 0 && (
        <>
          <h3 className="axis-h">Who pressures your life</h3>
          <ul className="axes">
            {opponents
              .sort((a, b) => b[1].life - a[1].life)
              .map(([name, p]) => (
                <li key={name}>
                  <span className="al">{name}</span>
                  <span className="ab warmbar">
                    <i style={{ width: `${100 * p.life}%` }} />
                  </span>
                  <span className="av num">{pc(p.life)}</span>
                </li>
              ))}
          </ul>
          <p className="small sub">Worked out automatically from each deck&apos;s own profile; the hardest-hitting deck in your tracker is 100%.</p>
        </>
      )}

      <h3 className="axis-h">Costs: worth paying?</h3>
      {harm.length === 0 ? (
        <p className="msg">No card in this deck costs you anything it can&apos;t use.</p>
      ) : (
        <div className="tbl">
          <table>
            <thead>
              <tr>
                <th>Card</th>
                <th>Costs you</th>
                {opponents.map(([n]) => (
                  <th key={n}>vs {n}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {harm.map((h) => (
                <tr key={h.name}>
                  <td>{h.name}</td>
                  <td>{h.costs.map((c) => fmtCost(c) + (c.optional ? " (optional)" : "")).join(" or ")}</td>
                  {opponents.map(([n]) => {
                    const v = h.vs.find((x) => x.opp === n);
                    return (
                      <td key={n}>
                        <span className={`pill ${v.worth ? "good" : "bad"}`}>{v.worth ? "Worth it" : "Too costly"}</span>
                        {v.choose && <span className="sub small"> pay {COST_WORD[v.choose]}</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {fuelCards.length > 0 && (
        <p className="small">
          <b>Fuel:</b>{" "}
          {fuelCards
            .map((c) => `${c.name} (${c.costs.filter((x) => x.fuel).map((x) => COST_WORD[x.kind]).join(", ")})`)
            .join(", ")}
          . This deck pays those costs off, so they don&apos;t count against the card, and when there&apos;s a choice you&apos;d always pick the fuel.
        </p>
      )}
      <p className="small sub">
        How the verdict works: a life payment costs (life ÷ 20) × how hard that opponent pressures your life. A card or a creature is
        taken as {pc(KILL_EQUIV.cards)} of a kill, tempo as {pc(KILL_EQUIV.tempo)}. Those exchange rates are assumptions; Claude&apos;s
        review flags where they mislead. Card effects are read from card text, so a few will be off.
      </p>

      <details className="cardscores">
        <summary>Each card&apos;s scores</summary>
        <div className="tbl">
          <table>
            <thead>
              <tr>
                <th>Card</th>
                {[...WIN_AXES, ...RESOURCE_AXES].map((a) => (
                  <th key={a.id} className="r">
                    {a.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {profile.cards.map((c) => (
                <tr key={c.name}>
                  <td>
                    {c.qty} {c.name}
                  </td>
                  {[...WIN_AXES, ...RESOURCE_AXES].map((a) => {
                    const v = c.axes[a.id];
                    const sw = v.mine + v.theirs - v.cost;
                    return (
                      <td key={a.id} className="r num" title={`you +${v.mine}, them −${v.theirs}, cost ${v.cost}`}>
                        {sw ? (Math.round(sw * 100) / 100).toString() : ""}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
