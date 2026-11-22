import { generateTextFromImages, type ImageInput } from "./gemini";

/**
 * 가려진 계약서 이미지에서 글자를 옮겨 적는다(OCR).
 * 이미지 데이터·추출한 원문은 로그나 에러 메시지에 남기지 않고 아무것도 저장하지 않는다.
 */

export const MAX_FILES = 5;
export const MAX_TOTAL_BASE64_CHARS = 3_000_000; // base64 합계 약 3MB
const ALLOWED_MIME_TYPE = "image/jpeg";
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const JPEG_BASE64_PREFIX = "/9j/"; // JPEG 시작 바이트(FF D8 FF)의 base64

export const EXTRACT_PROMPT = [
  "첨부된 계약서 이미지의 글자를 보이는 그대로 옮겨 적어라.",
  "요약, 해석, 교정, 추가를 하지 않는다.",
  "조항 번호와 줄바꿈을 유지한다.",
  "검정색으로 가려진 부분은 [가림]으로 표시하고, 읽을 수 없는 부분은 [판독불가]로 표시한다.",
  "여러 장이면 순서대로 이어 붙인다.",
  "설명 없이 본문 텍스트만 출력한다.",
].join("\n");

/** 요청 형식이 올바르지 않을 때 (400) */
export class ExtractInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractInputError";
  }
}

/** 글자를 하나도 읽지 못했을 때 */
export class ExtractEmptyError extends Error {
  constructor() {
    super("글자를 읽지 못했어요");
    this.name = "ExtractEmptyError";
  }
}

export function parseImages(body: unknown): ImageInput[] {
  const files = (body as { files?: unknown } | null)?.files;

  if (!Array.isArray(files) || files.length === 0) {
    throw new ExtractInputError("이미지를 보내 주세요");
  }
  if (files.length > MAX_FILES) {
    throw new ExtractInputError(`이미지는 최대 ${MAX_FILES}장까지 보낼 수 있어요`);
  }

  let total = 0;
  const images: ImageInput[] = [];

  for (const file of files) {
    const mimeType = (file as { mimeType?: unknown } | null)?.mimeType;
    const data = (file as { data?: unknown } | null)?.data;

    if (mimeType !== ALLOWED_MIME_TYPE) {
      throw new ExtractInputError("JPEG 이미지만 보낼 수 있어요");
    }
    if (typeof data !== "string" || data.length === 0 || !BASE64_PATTERN.test(data)) {
      throw new ExtractInputError("이미지 형식이 올바르지 않아요");
    }
    if (!data.startsWith(JPEG_BASE64_PREFIX)) {
      throw new ExtractInputError("이미지 형식이 올바르지 않아요");
    }

    total += data.length;
    if (total > MAX_TOTAL_BASE64_CHARS) {
      throw new ExtractInputError("이미지 용량이 너무 커요. 장수를 줄이거나 더 작은 사진을 올려 주세요");
    }

    images.push({ mimeType, data });
  }

  return images;
}

function stripCodeFence(text: string): string {
  const match = text.match(/^```[a-zA-Z]*\n([\s\S]*?)\n?```$/);
  return match ? match[1] : text;
}

export async function extractText(images: ImageInput[]): Promise<string> {
  const raw = await generateTextFromImages(EXTRACT_PROMPT, images, { thinkingLevel: "low" });
  const text = stripCodeFence(raw.trim()).trim();

  if (text.length === 0) {
    throw new ExtractEmptyError();
  }

  return text;
}
