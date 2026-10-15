import Link from "next/link";
import DeckForm from "@/components/DeckForm";
import { canWrite } from "@/lib/notion";

export const dynamic = "force-dynamic";
export const metadata = { title: "Add a deck · Pickpocket Match Log" };

export default function NewDeckPage() {
  return (
    <div className="wrap">
      <header>
        <p className="crumb">
          <Link href="/">← Match log</Link>
        </p>
        <h1>Add a deck</h1>
        <p className="sub">
          Paste the list from MTG Arena (Decks → Export). The tracker uses it for the deck view and the dead-card choices, and Claude
          reads it from Notion when it reviews your matches.
        </p>
      </header>
      <DeckForm writable={canWrite()} />
    </div>
  );
}
