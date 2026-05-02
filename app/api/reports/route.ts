import { NextResponse } from "next/server";
import { createReport } from "@/lib/reports";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const report = await createReport({
    company: body.company || undefined,
    companies: Array.isArray(body.companies) ? body.companies : undefined,
    topic: body.topic || undefined,
    topics: Array.isArray(body.topics) ? body.topics : undefined,
    query: body.query || undefined,
    startDate: body.startDate || undefined,
    endDate: body.endDate || undefined,
  });
  return NextResponse.json({ report });
}
