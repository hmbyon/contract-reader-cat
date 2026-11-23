import { NextResponse } from "next/server";
import { ExtractEmptyError, ExtractInputError, extractText, parseImages } from "@/lib/extract";

export const maxDuration = 60;

const MAX_BODY_BYTES = 3_200_000;

export async function POST(request: Request) {
  // content-length가 없거나 숫자가 아니면(NaN) 통과시키고 아래 검사에 맡긴다.
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "요청이 너무 큽니다." }, { status: 413 });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const images = parseImages(body);
    const text = await extractText(images);
    return NextResponse.json({ text });
  } catch (error) {
    if (error instanceof ExtractInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof ExtractEmptyError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    // 이미지·추출 원문·키는 응답과 로그에 남기지 않는다.
    return NextResponse.json(
      { error: "글자 읽기에 실패했습니다. 잠시 후 다시 시도해 주세요" },
      { status: 500 }
    );
  }
}
