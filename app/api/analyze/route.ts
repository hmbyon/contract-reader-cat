import { NextResponse } from "next/server";
import { analyzeContract, PIIDetectedError } from "@/lib/analyze";

export const maxDuration = 60;

const MAX_TEXT_LENGTH = 20000;

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

  if (body.text.trim().length === 0) {
    return NextResponse.json({ error: "`text` must not be empty" }, { status: 400 });
  }

  if (body.text.length > MAX_TEXT_LENGTH) {
    return NextResponse.json(
      { error: `\`text\` must be ${MAX_TEXT_LENGTH} characters or fewer` },
      { status: 400 }
    );
  }

  try {
    const result = await analyzeContract(body.text);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof PIIDetectedError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    // 내부 에러 상세·본문·키는 응답과 로그에 남기지 않는다.
    return NextResponse.json(
      { error: "분석에 실패했습니다. 잠시 후 다시 시도해 주세요" },
      { status: 500 }
    );
  }
}
