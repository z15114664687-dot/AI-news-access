import { NextResponse } from "next/server";
import { listSignals } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const signals = await listSignals({
    company: url.searchParams.get("company") || undefined,
    topic: url.searchParams.get("topic") || undefined,
    query: url.searchParams.get("query") || undefined,
    startDate: url.searchParams.get("startDate") || undefined,
    endDate: url.searchParams.get("endDate") || undefined,
  });
  return NextResponse.json({ signals });
}
