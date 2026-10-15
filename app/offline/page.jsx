export const metadata = { title: "Offline · MTG Standard Deck Stats Tracker" };

export default function Offline() {
  return (
    <div className="wrap">
      <header>
        <p className="eyebrow">MTG Standard Deck Stats Tracker</p>
        <h1>No signal</h1>
        <p className="sub">
          Pages you&apos;ve opened before still load from your phone. This one hasn&apos;t been saved yet. Logging a match needs a connection;
          note the result and add it when you&apos;re back online.
        </p>
      </header>
    </div>
  );
}
