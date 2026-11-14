import { NextResponse } from "next/server";

type AnalyzeRequest = {
  text: string;
};

export async function POST(request: Request) {
  let body: AnalyzeRequest;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body?.text !== "string") {
    return NextResponse.json({ error: "`text` must be a string" }, { status: 400 });
  }

  // AI 호출은 아직 없음.
  return NextResponse.json({ status: "ok" });
}
