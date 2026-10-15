import { NextResponse } from "next/server";
import { connectionReport } from "@/lib/notion";

export const dynamic = "force-dynamic";

/** Setup check. Shows which settings exist and whether Notion answers; never shows values. */
export async function GET() {
  return NextResponse.json(await connectionReport(), { headers: { "cache-control": "no-store" } });
}
