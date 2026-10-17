"use client";

import { useMemo, useState } from "react";
import { analyzeDeck, pSeen, shortLabels } from "@/lib/graph.mjs";
import { pct } from "@/lib/stats.mjs";
import { isAutoEdges } from "@/lib/autoedges.mjs";
import { CardName } from "./CardInfo";

const VIEW = 640;
const R = 200;
const PAD_X = 120; // room for labels left and right of the circle

/** Place cards on a circle so neighbours sit near each other: greedy order from the hub. */
function circleOrder(cards) {
  if (!cards.length) return [];
  const nb = new Map(cards.map((c) => [c.name, new Set(c.neighbors)]));
  const left = new Set(cards.map((c) => c.name));
  const order = [cards[0].name];
  left.delete(cards[0].name);
  while (left.size) {
    const placed = new Set(order);
    let best = null;
    let score = -1;
    for (const n of left) {
      const sc = [...nb.get(n)].filter((x) => placed.has(x)).length * 10 + (nb.get(order.at(-1)).has(n) ? 5 : 0) + nb.get(n).size / 100;
      if (sc > score) (best = n), (score = sc);
    }
    order.push(best);
    left.delete(best);
  }
  return order;
}

/**
 * mode "synergy" (default): the deck's synergy graph.
 * mode "misery": the Jeffery Jones misery graph, drawn inside the Fun Ranking panel
 * (pass the misery edges as deck.edges); same layout, its own wording, no table.
 */
export default function GraphPanel({ deck, matches = [], mode = "synergy" }) {
  const M = mode === "misery";
  const [focus, setFocus] = useState(null);
  const deadCounts = useMemo(() => {
    const m = new Map();
    for (const x of matches) if (x.deadCard) m.set(x.deadCard, (m.get(x.deadCard) ?? 0) + 1);
    return m;
  }, [matches]);
  const g = useMemo(() => analyzeDeck(deck.main, deck.edges, { deadCounts }), [deck.main, deck.edges, deadCounts]);

  const labels = useMemo(() => shortLabels(g.cards.map((c) => c.name)), [g.cards]);
  const pos = useMemo(() => {
    const order = circleOrder(g.cards);
    return new Map(
      order.map((n, i) => {
        const a = (2 * Math.PI * i) / order.length - Math.PI / 2;
        return [n, { x: VIEW / 2 + R * Math.cos(a), y: VIEW / 2 + R * Math.sin(a), a }];
      }),
    );
  }, [g.cards]);

  if (!deck.edges) {
    return (
      <section>
        <h2>Synergy graph</h2>
        <p className="msg">
          No synergy edges for this deck yet. Claude adds them with its pre-test review. You can also write them in Notion (Pickpocket
          Decks → Synergy Edges), one per line as <code>Card A -- Card B | why</code>.
        </p>
      </section>
    );
  }

  const hubs = g.cards.filter((c) => c.degree > 0).slice(0, 3);
  const hubCopies = hubs.reduce((s, c) => s + c.copies, 0);
  const pAnyHub = pSeen(hubCopies, 10);
  const cutCards = g.cards.filter((c) => c.cut);
  const weak = g.cards.filter((c) => c.degree <= 2 && c.dead >= 2);
  const focusSet = focus ? new Set([focus, ...(g.cards.find((c) => c.name === focus)?.neighbors ?? [])]) : null;
  const dim = (n) => (focusSet && !focusSet.has(n) ? 0.18 : 1);

  const tiles = M
    ? [
        ["Misery links", g.edgeCount, "pairs that make each other worse to face"],
        ["Ringleader", hubs[0] ? labels.get(hubs[0].name) ?? hubs[0].name : "—", hubs[0] ? `${hubs[0].degree} links` : "nothing compounds"],
        ["Bystanders", g.isolated.length, "cards that don't compound anything"],
      ]
    : [
    ["Cards", g.vertexCount, "nonland cards in the main deck"],
    ["Synergies", g.edgeCount, `density ${g.density.toFixed(2)}`],
    ["Engines", g.components.length, g.components.length === 1 ? "one connected engine" : "separate plans"],
    ["Isolated", g.isolated.length, g.isolated.length ? "cards with no synergy" : "every card connects"],
    ["Cut vertices", g.cuts.length, "single points of failure"],
    ["λ₂", g.lambda2.toFixed(2), "algebraic connectivity"],
    ["Live by T4", g.live[4].toFixed(1), "expected synergies with both cards seen"],
    ["Live by T7", g.live[7].toFixed(1), "on the play"],
  ];

  const Wrap = M ? "div" : "section";
  return (
    <Wrap className={M ? "misery" : undefined}>
      {M ? (
        <h3 className="axis-h">Misery graph</h3>
      ) : (
        <h2>Synergy graph</h2>
      )}
      <p className="sub small">
        {M
          ? "A line means the two cards make each other worse to play against: one sets up the misery, the other cashes it in. Tap a card to see its partners in crime."
          : "Each card is a node; a line means the two cards make each other better. Dashed red lines are conflicts. Tap a card to see what it connects to."}
      </p>
      {!M && isAutoEdges(deck.edges) && (
        <p className="banner">
          <b>First-pass graph.</b> These links were found automatically from card text: what each card produces and which cards pay it
          off. Claude replaces them with a reviewed set within about an hour. Removal and counterspells often show as isolated here; that
          usually means they&apos;re there to interact, not that they&apos;re weak.
        </p>
      )}

      <div className="strip tight">
        {tiles.map(([k, v, sub]) => (
          <div className="stat" key={k}>
            <span className="k">{k}</span>
            <span className="v">{v}</span>
            <span className="n">{sub}</span>
          </div>
        ))}
      </div>

      <div className="graphwrap">
        <svg viewBox={`${-PAD_X} 20 ${VIEW + 2 * PAD_X} ${VIEW - 40}`} role="img" aria-label={`Synergy graph of ${deck.name}: ${g.vertexCount} cards, ${g.edgeCount} synergies`}>
          {g.edges.map((e) => {
            const p = pos.get(e.a);
            const q = pos.get(e.b);
            const on = !focus || e.a === focus || e.b === focus;
            return (
              <line key={`${e.a}|${e.b}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} className="g-edge" style={{ opacity: on ? 0.55 : 0.06 }}>
                <title>{`${e.a} — ${e.b}${e.reason ? `: ${e.reason}` : ""}`}</title>
              </line>
            );
          })}
          {g.conflicts.map((e) => {
            const p = pos.get(e.a);
            const q = pos.get(e.b);
            return (
              <line key={`c${e.a}|${e.b}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} className="g-conflict" style={{ opacity: focus && e.a !== focus && e.b !== focus ? 0.1 : 0.9 }}>
                <title>{`Conflict: ${e.a} vs ${e.b}${e.reason ? `: ${e.reason}` : ""}`}</title>
              </line>
            );
          })}
          {g.cards.map((c) => {
            const p = pos.get(c.name);
            const r = 10 + 4 * Math.sqrt(c.copies);
            const cls = c.cut ? "g-node cut" : c.isolated ? "g-node iso" : c.hub ? "g-node hub" : "g-node";
            const lx = VIEW / 2 + (R + r + 10) * Math.cos(p.a);
            // Labels straight above/below the circle are centred; drop the bottom one a line so it clears its neighbours.
            const ly = VIEW / 2 + (R + r + 10) * Math.sin(p.a) + (Math.sin(p.a) > 0.97 ? 18 : 0);
            const anchor = Math.abs(Math.cos(p.a)) < 0.05 ? "middle" : Math.cos(p.a) > 0 ? "start" : "end";
            return (
              <g
                key={c.name}
                style={{ opacity: dim(c.name), cursor: "pointer" }}
                onClick={() => setFocus(focus === c.name ? null : c.name)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setFocus(focus === c.name ? null : c.name)}
                tabIndex={0}
                role="button"
                aria-pressed={focus === c.name}
                aria-label={`${c.name}: ${c.degree} synergies`}
              >
                <circle cx={p.x} cy={p.y} r={r} className={cls} />
                <text x={p.x} y={p.y + 6} className="g-deg">
                  {c.degree}
                </text>
                <text x={lx} y={ly + 8} textAnchor={anchor} className="g-label">
                  {labels.get(c.name)}
                </text>
              </g>
            );
          })}
        </svg>
        <ul className="legend">
          <li>
            <i className="dot hub" /> {M ? "Ringleader (most misery links)" : "Hub (most synergies)"}
          </li>
          {!M && (
            <li>
              <i className="dot cut" /> Cut vertex
            </li>
          )}
          <li>
            <i className="dot" /> Other card · size = copies · number = {M ? "misery links" : "synergies"}
          </li>
          {!M && (
            <li>
              <i className="dash" /> Conflict
            </li>
          )}
        </ul>
      </div>

      <div className="findings">
        {M && hubs.length > 0 && (
          <p>
            <b>Ringleaders:</b> {hubs.map((c) => `${c.name} (${c.degree} links)`).join(", ")}. Take these out and the deck gets a lot friendlier.
          </p>
        )}
        {M && g.isolated.length > 0 && (
          <p>
            <b>Bystanders:</b> {g.isolated.join(", ")}. They may sting on their own, but they don&apos;t make anything else worse.
          </p>
        )}
        {!M && hubs.length > 0 && (
          <p>
            <b>Hubs:</b> {hubs.map((c) => `${c.name} (${c.degree}, ${c.copies} cop${c.copies === 1 ? "y" : "ies"})`).join(", ")}. At least one of
            them shows up by turn 4 in {pct(pAnyHub)} of games.
            {hubs.some((c) => c.copies < 4) && " The best-connected cards are capped below 4 copies, so tutors and re-buys matter more than raw copy count."}
          </p>
        )}
        {!M && cutCards.map((c) => (
          <p key={c.name}>
            <b>Single point of failure:</b> without {c.name}, {c.stranded.join(", ")} lose{c.stranded.length === 1 ? "s" : ""} every connection to the
            engine.
          </p>
        ))}
        {!M && g.isolated.length > 0 && (
          <p>
            <b>Isolated:</b> {g.isolated.join(", ")}.{" "}
            {isAutoEdges(deck.edges)
              ? "Nothing in their text links them to the rest of the deck. That's normal for removal and counterspells; Claude's review will say if it matters."
              : "They help only on their own; first cards to question."}
          </p>
        )}
        {g.conflicts.map((e) => (
          <p key={`f${e.a}${e.b}`}>
            <b>Conflict:</b> {e.a} and {e.b}
            {e.reason ? `: ${e.reason}` : ""}.
          </p>
        ))}
        {weak.length > 0 && (
          <p>
            <b>Low synergy and flagged dead:</b> {weak.map((c) => `${c.name} (${c.degree} synergies, dead ${c.dead}×)`).join(", ")}. The
            graph and your games agree; these are cut candidates.
          </p>
        )}
        {g.problems.length > 0 && <p className="err">Edge list problems: {g.problems.join(" ")}</p>}
      </div>

      {!M && (
      <div className="tbl">
        <table>
          <thead>
            <tr>
              <th>Card</th>
              <th className="r">Copies</th>
              <th className="r">Synergies</th>
              <th className="r">Seen by T4</th>
              <th className="r">Dead flags</th>
              <th>Role</th>
            </tr>
          </thead>
          <tbody>
            {g.cards.map((c) => (
              <tr key={c.name} className={focus === c.name ? "sel" : undefined}>
                <td>
                  <button className="focusdot" onClick={() => setFocus(focus === c.name ? null : c.name)} aria-label={`Highlight ${c.name} in the graph`} aria-pressed={focus === c.name} title="Highlight in the graph">
                    ◎
                  </button>{" "}
                  <CardName name={c.name} />
                </td>
                <td className="r num">{c.copies}</td>
                <td className="r num">{c.degree}</td>
                <td className="r num">{pct(c.pT4)}</td>
                <td className="r num">{c.dead || "—"}</td>
                <td>
                  {c.hub && <span className="pill good">Hub</span>} {c.cut && <span className="pill bad">Cut vertex</span>}{" "}
                  {c.isolated && <span className="pill na">Isolated</span>}
                  {c.conflicts.length > 0 && <span className="pill warn">Conflict</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
    </Wrap>
  );
}
