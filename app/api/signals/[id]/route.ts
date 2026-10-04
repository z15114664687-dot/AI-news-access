import { NextResponse } from "next/server";
import { getSignal, updateSignalReview } from "@/lib/db";
import { materialHistory } from "@/lib/materials";
import { sameOriginMutation } from "@/lib/requestOrigin";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const { id } = await context.params;
  const signal = getSignal(id);
  return signal ? NextResponse.json({ signal, materials: materialHistory(id) }) : NextResponse.json({ error: "Signal not found" }, { status: 404 });
}

export async function PATCH(request: Request, context: Context) {
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Cross-origin mutation denied" }, { status: 403 });
  const { id } = await context.params;
  const input = await request.json().catch(() => null);
  if (!input || typeof input.status !== "string" || typeof input.note !== "string" || !Number.isInteger(input.revision) || typeof input.updatedAt !== "string") return NextResponse.json({ error: "Invalid review" }, { status: 400 });
  try {
    return NextResponse.json({ signal: updateSignalReview(id, input) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Review failed";
    return NextResponse.json({ error: message }, { status: message.includes("not found") ? 404 : message.includes("changed") ? 409 : 400 });
  }
}
