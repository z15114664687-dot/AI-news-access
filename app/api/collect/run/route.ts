import { NextResponse } from "next/server";
import { runCollection } from "@/lib/collector";

export const runtime = "nodejs";

export async function POST() {
  const run = await runCollection();
  return NextResponse.json({ run });
}
