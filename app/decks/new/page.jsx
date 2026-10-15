import Link from "next/link";
import DeckForm from "@/components/DeckForm";
import { canWrite } from "@/lib/notion";

export const dynamic = "force-dynamic";
export const metadata = { title: "Add a deck · MTG Standard Deck Stats Tracker" };

export default function NewDeckPage() {
  return (
    <div className="wrap">
      <header>
        <p className="crumb">
          <Link href="/">← All decks</Link>
        </p>
        <h1>Add a deck</h1>
        <p className="sub">
          Paste the list from MTG Arena (Decks → Export). When you save, the deck&apos;s page opens with a pre-test report (mana,
          curve, opening hands, sideboard checks), and the deck goes to Claude in the project for a written review and synergy edges.
        </p>
      </header>
      <DeckForm writable={canWrite()} />
    </div>
  );
}
