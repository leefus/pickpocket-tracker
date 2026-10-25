import Link from "next/link";
import { redirect } from "next/navigation";
import { getDecks, getMatchSummary, hasNotion, missingSettings } from "@/lib/notion";
import { colorCode } from "@/lib/meta.mjs";
import { pct } from "@/lib/stats.mjs";
import { HeaderBrand } from "@/components/Brand";
import { getCardData } from "@/lib/scryfall";
import { jonesField } from "@/lib/jones.mjs";

export const dynamic = "force-dynamic";

const ago = (iso) => {
  if (!iso) return "";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00`) : new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

export default async function StartPage({ searchParams }) {
  // Links from before the start page existed: /?deck=<id>
  if (searchParams?.deck) redirect(`/decks/${searchParams.deck}`);

  const connected = hasNotion();
  const missing = missingSettings();
  let decks = [];
  let summary = {};
  let loadError = null;
  try {
    [decks, summary] = await Promise.all([getDecks(), getMatchSummary()]);
  } catch (err) {
    console.error("start page load failed", err);
    loadError = "Couldn't load decks from Notion. Check the token and that the integration is connected to both databases.";
  }

  // The Jeffery Jones Fun Ranking across every active deck.
  let ranking = [];
  try {
    const active = decks.filter((d) => d.status !== "Retired");
    const data = await Promise.all(active.map((d) => getCardData(d.main, d.side)));
    const ranked = jonesField(active.map((d, i) => ({ id: d.id, name: d.name, main: d.main, cards: data[i].cards })));
    ranking = Object.entries(ranked)
      .map(([id, j]) => ({ id, name: j.name, index: j.index, tier: j.tier, rank: j.rank }))
      .sort((a, b) => a.rank - b.rank);
  } catch (err) {
    console.error("fun ranking failed", err);
  }

  return (
    <div className="wrap">
      <header className="hdr">
        <div>
          <p className="eyebrow">MTG Standard Deck Stats Tracker</p>
          <h1>Pick a deck</h1>
          <p className="sub">Open a deck to log matches, or add a new one. A new deck gets a pre-test report straight away, and Claude reviews it within about an hour.</p>
        </div>
        <HeaderBrand />
      </header>

      {!connected && (
        <div className="banner">
          Not connected to Notion yet. This deployment can&apos;t see: <b>{missing.join(", ")}</b>. Add {missing.length > 1 ? "them" : "it"} in
          Vercel (Settings → Environment Variables, with Production ticked), then redeploy. <a href="/api/status">Check setup</a>
        </div>
      )}
      {loadError && <div className="banner err">{loadError}</div>}

      <ul className="decklist">
        {decks.map((d) => {
          const s = summary[d.id] ?? { n: 0, wins: 0, last: null };
          return (
            <li key={d.id}>
              <Link href={`/decks/${d.id}`} className={`deckcard${d.status === "Retired" ? " retired" : ""}`}>
                <b>{d.name}</b>
                <p className="sub">{[d.format, d.archetype, colorCode(d.colors), d.status].filter(Boolean).join(" · ")}</p>
                <span className="rec">
                  {s.n ? `${s.wins}–${s.n - s.wins} · ${pct(s.wins / s.n)} · last played ${ago(s.last)}` : "No matches yet"}
                </span>
                <span className="claude-line">
                  {d.analysisRequested ? (
                    <span className="pill warn">With Claude since {ago(d.requestedAt)}</span>
                  ) : d.review ? (
                    <span className="pill good">Claude reviewed {ago(d.reviewedAt)}</span>
                  ) : (
                    <span className="pill na">No Claude review yet</span>
                  )}
                </span>
              </Link>
            </li>
          );
        })}
        <li>
          <Link href="/build" className="deckcard new">
            <b>+ Build from seeds</b>
            <p className="sub">Name one or more cards to build around. The app:</p>
            <ol className="steps">
              <li>Finds what they need and grows a deck by role</li>
              <li>Sets the land count and mana</li>
              <li>Swaps in faster cards with the goldfish, then you save it</li>
            </ol>
          </Link>
        </li>
        <li>
          <Link href="/decks/new" className="deckcard new">
            <b>+ Add a new deck</b>
            <p className="sub">Paste an Arena export. You&apos;ll get:</p>
            <ol className="steps">
              <li>A pre-test report: mana, curve, opening hands and sideboard checks</li>
              <li>A review from Claude in this project, with synergy edges</li>
              <li>A tracking page for logging matches</li>
            </ol>
          </Link>
        </li>
      </ul>

      {ranking.length > 1 && (
        <section className="jones">
          <h2>Jeffery Jones Fun Ranking</h2>
          <p className="sub small">
            <i>Jeff&apos;s axiom:</i> a game only holds so much fun, so the more you have, the less your opponent does. Most un-fun (for your opponent) first.
          </p>
          <ol className="leaderboard">
            {ranking.map((r) => (
              <li key={r.id}>
                <span className="rk num">{r.rank}</span>
                <Link href={`/decks/${r.id}`} className="nm">
                  {r.name}
                </Link>
                <span className="ab warmbar">
                  <i style={{ width: `${r.index}%` }} />
                </span>
                <span className="ix num">{r.index}</span>
                <span className="tr sub small">{r.tier}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
