import Tracker from "@/components/Tracker";
import { canWrite, getMatches, hasNotion } from "@/lib/notion";

// Matches change every time you log one; always read fresh from Notion.
export const dynamic = "force-dynamic";

export default async function Page() {
  let matches = [];
  let loadError = null;
  try {
    matches = await getMatches();
  } catch (err) {
    console.error("getMatches failed", err);
    loadError = "Couldn't load matches from Notion. Check the token and that the integration is connected to the database.";
  }

  return <Tracker matches={matches} writable={canWrite()} connected={hasNotion()} loadError={loadError} />;
}
