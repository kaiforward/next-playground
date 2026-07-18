import { NextRequest, NextResponse } from "next/server";
import { setAutomation } from "@/lib/services/construction-orders";
import { automationSchema } from "@/lib/schemas/construction-orders";
import { parseJsonBody } from "@/lib/api/parse-json";
import type { ApiResponse, AutomationResponse } from "@/lib/types/api";

export async function POST(request: NextRequest) {
  const body = await parseJsonBody<{ build?: boolean; colonisation?: boolean }>(request);
  const parsed = automationSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join(", ");
    return NextResponse.json<ApiResponse<never>>({ error: message }, { status: 400 });
  }
  const result = setAutomation(parsed.data);
  if (!result.ok) return NextResponse.json<ApiResponse<never>>({ error: result.error }, { status: 400 });
  return NextResponse.json<AutomationResponse>({ data: result.data });
}
