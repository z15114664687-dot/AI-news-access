import { NextResponse } from "next/server";
import { startCollection } from "@/lib/collector";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const run = await startCollection({ days: Number(body.days) || undefined });
  if (run.status === "already-running") {
    return NextResponse.json({ run: { id: run.id, status: run.status } }, { status: 409 });
  }
  return NextResponse.json({ run: { id: run.id, status: run.status } }, { status: 202 });
}
