import { NextResponse } from "next/server";
import { applyTopicSuggestion, resetTopicOverride, suggestTopic, TopicError } from "@/lib/jev";
import { sameOriginMutation } from "@/lib/requestOrigin";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Cross-origin mutation denied" }, { status: 403 });
  const input = await request.json().catch(() => null);
  if (!input || !["suggest", "apply", "reset"].includes(input.action) || !Number.isInteger(input.revision) || typeof input.updatedAt !== "string" || (input.action === "apply" && (typeof input.hash !== "string" || !/^[a-f0-9]{64}$/.test(input.hash)))) return NextResponse.json({ error: "无效分类请求" }, { status: 400 });
  const { id } = await context.params;
  try {
    if (input.action === "suggest") return NextResponse.json({ suggestion: await suggestTopic(id, input) });
    const signal = input.action === "apply" ? applyTopicSuggestion(id, input.hash, input) : resetTopicOverride(id, input);
    return NextResponse.json({ signal });
  } catch (error) {
    return NextResponse.json({ error: error instanceof TopicError ? error.message : "分类处理失败，未自动重试。" }, { status: error instanceof TopicError ? error.status : 500 });
  }
}
