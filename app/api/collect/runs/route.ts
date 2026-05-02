import { NextResponse } from "next/server";
import { listCollectionRuns, listSources } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const [runs, sources] = await Promise.all([listCollectionRuns(20), listSources()]);
  return NextResponse.json({ runs, sources });
}
