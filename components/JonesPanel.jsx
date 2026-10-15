import { CATEGORIES, TIERS } from "@/lib/jones.mjs";
import GraphPanel from "./GraphPanel";

/**
 * The Jeffery Jones Fun Ranking for one deck.
 * `jones` = { index, tier, totals, cards, edgesText, edgeCount, rank, of, maxTotals }
 */
export default function JonesPanel({ jones, deck }) {
  if (!jones) return null;
  const offenders = jones.cards.filter((c) => c.total > 0).slice(0, 5);
  return (
    <section className="jones">
      <h2>Jeffery Jones Fun Ranking</h2>
      <p className="sub small">
        <i>Jeff&apos;s axiom:</i> a game only holds so much fun. The more fun you&apos;re having, the less your opponent is. This measures how
        un-fun this deck makes the other side of the table.
      </p>

      <div className="jones-head">
        <div className="jones-score">
          <span className="v num">{jones.index}</span>
          <span className="k">/ 100</span>
        </div>
        <div>
          <b className="jones-tier">{jones.tier}</b>
          <p className="sub small">
            {jones.of > 1 ? `#${jones.rank} most un-fun of the ${jones.of} decks in your tracker.` : "The only deck in your tracker so far."}{" "}
            {jones.edgeCount > 0 && `${jones.edgeCount} pairs of cards make each other worse to face.`}
          </p>
          <ol className="tiers" aria-label="Tiers">
            {TIERS.map(([min, name]) => (
              <li key={name} className={name === jones.tier ? "on" : undefined}>
                <span className="num">{min}+</span> {name}
              </li>
            ))}
          </ol>
        </div>
      </div>

      <ul className="axes">
        {CATEGORIES.map((c) => (
          <li key={c.id}>
            <span className="al" title={c.blurb}>
              {c.label}
            </span>
            <span className="ab warmbar">
              <i style={{ width: `${(100 * jones.totals[c.id]) / Math.max(1e-9, jones.maxTotals[c.id])}%` }} />
            </span>
            <span className="av num">{jones.totals[c.id].toFixed(1)}</span>
          </li>
        ))}
      </ul>
      <p className="small sub">Bars compare with the saltiest deck in your tracker in each category.</p>

      {offenders.length > 0 && (
        <>
          <h3 className="axis-h">Worst offenders</h3>
          <ul className="offenders">
            {offenders.map((c) => (
              <li key={c.name}>
                <b>
                  {c.qty} {c.name}
                </b>{" "}
                <span className="sub">{c.why.join(", ")}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {jones.edgesText ? (
        <GraphPanel deck={{ ...deck, edges: jones.edgesText }} mode="misery" />
      ) : (
        <p className="msg">No cards here compound each other&apos;s misery. Each one is unpleasant on its own terms, if at all.</p>
      )}

      <p className="small sub">
        How it&apos;s scored: each card&apos;s text is checked for disruption (discard, counters, &quot;can&apos;t&quot;, tapping, stealing,
        board wipes), decision fatigue (flash, &quot;unless they pay&quot;, ward, modes, acting on their turn), annoyance (repeated pings,
        upkeep triggers, things that won&apos;t stay dead, swarms) and confusion (using their own cards, two-faced cards, unusual keywords,
        copies). Misery pairs: taking their card + playing it; locking them out + hitting them; doubling a trigger; protecting the thing that
        hurts; profiting from their losses. Pairs add √pairs × 3, so they can&apos;t swamp the cards themselves.
      </p>
    </section>
  );
}
