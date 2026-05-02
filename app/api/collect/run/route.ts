import { NextResponse } from "next/server";
import { runCollection } from "@/lib/collector";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const run = await runCollection({ days: Number(body.days) || undefined });
  return NextResponse.json({ run });
}
