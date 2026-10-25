import Link from "next/link";
import SeedBuilder from "@/components/SeedBuilder";
import { canWrite } from "@/lib/notion";
import { HeaderBrand } from "@/components/Brand";
import poolData from "@/lib/data/standard-pool.json";

export const dynamic = "force-dynamic";
// The build (graph growth + goldfish refinement) runs as a server action on this page.
export const maxDuration = 60;
export const metadata = { title: "Build from seeds · MTG Standard Deck Stats Tracker" };

export default function BuildPage() {
  const names = [...new Set(poolData.cards.map((c) => c.name.split(" // ")[0]))].sort();
  return (
    <div className="wrap">
      <header className="hdr">
        <div>
          <p className="crumb">
            <Link href="/">← All decks</Link>
          </p>
          <h1>Build from seeds</h1>
          <p className="sub">
            Name one or more cards you want to build around. The app finds what they need, grows a deck from them by role, sets the
            mana, then plays it against a goldfish to swap in faster cards. Nothing is saved until you say so.
          </p>
        </div>
        <HeaderBrand />
      </header>
      <SeedBuilder names={names} poolDate={poolData.updated} writable={canWrite()} />
    </div>
  );
}
