import { NextResponse } from "next/server";
import { listCollectionRuns, listSources } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const [runs, sources] = await Promise.all([listCollectionRuns(20), listSources()]);
  return NextResponse.json({
    runs,
    sources,
    config: {
      hasGeminiKey: Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
      geminiModel: process.env.GEMINI_MODEL || "gemini-2.5-flash",
      defaultDays: Number(process.env.COLLECT_DAYS || 30),
      queryLimit: Number(process.env.COLLECT_QUERY_LIMIT || 12),
    },
  });
}
