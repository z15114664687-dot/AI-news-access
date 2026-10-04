import { NextResponse } from "next/server";
import { getSyncState, syncAIHOT } from "@/lib/aihot";
import { sameOriginMutation } from "@/lib/requestOrigin";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ state: getSyncState() });
}

export async function POST(request: Request) {
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Cross-origin mutation denied" }, { status: 403 });
  try {
    const result = await syncAIHOT();
    return NextResponse.json({ ...result, state: getSyncState() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AIHOT sync failed";
    return NextResponse.json({ error: message, state: getSyncState() }, { status: message.includes("already running") ? 409 : 502 });
  }
}
