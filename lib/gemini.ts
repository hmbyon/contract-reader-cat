import { getGeminiApiKey } from "./env";

/**
 * Gemini API 호출 래퍼.
 *
 * ai.google.dev 문서 기준(2026-11), generateContent는 legacy로 표시되고
 * Interactions API(POST https://generativelanguage.googleapis.com/v1beta/interactions)가
 * 신규 프로젝트에 권장되는 방식이라 이를 사용한다.
 *
 * 프롬프트·계약서 본문·API 키는 어떤 로그·에러 메시지에도 넣지 않는다.
 */

const INTERACTIONS_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";
const DEFAULT_TIMEOUT_MS = 45_000;
const MAX_ATTEMPTS = 2; // 최초 1회 + JSON 파싱 실패 시 1회 재시도

// 일시적 오류로 보는 HTTP status. 이 값일 때만 1초, 2초 순서로 대기하며 최대 2회 재시도한다.
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const HTTP_RETRY_DELAYS_MS = [1000, 2000];

export type InteractionInputPart =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mime_type: string };

export interface GenerateJsonOptions {
  thinkingLevel?: "low" | "medium" | "high";
  timeoutMs?: number;
}

function getModel(): string {
  const model = process.env.GEMINI_MODEL;

  if (!model) {
    throw new Error("GEMINI_MODEL is not set. Add it to .env.local");
  }

  return model;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

interface InteractionOptions extends GenerateJsonOptions {
  // true이면 JSON 응답 형식 지정 없이 일반 텍스트로 받는다.
  plainText?: boolean;
}

async function callInteractions(
  input: string | InteractionInputPart[],
  options?: InteractionOptions
): Promise<unknown> {
  const apiKey = getGeminiApiKey();
  const model = getModel();
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const requestBody: Record<string, unknown> = {
    model,
    input,
  };

  if (!options?.plainText) {
    requestBody.response_format = {
      type: "text",
      mime_type: "application/json",
    };
  }

  // thinking_level은 generation_config 안에 넣는다 (ai.google.dev Interactions API 문서 기준).
  if (options?.thinkingLevel) {
    requestBody.generation_config = { thinking_level: options.thinkingLevel };
  }

  const maxAttempts = HTTP_RETRY_DELAYS_MS.length + 1; // 최초 1회 + 일시적 오류 재시도 최대 2회
  let timeoutRetried = false; // 타임아웃(AbortError)은 이 재시도 횟수와 별도로 1회만 재시도한다.

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(INTERACTIONS_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
    } catch (error) {
      if (isAbortError(error)) {
        if (!timeoutRetried) {
          timeoutRetried = true;
          attempt -= 1; // 상태코드 재시도 횟수를 소모하지 않고 한 번 더 시도한다.
          continue;
        }
        throw new Error("Gemini API 응답 시간 초과");
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }

    if (response.ok) {
      return await response.json();
    }

    if (!RETRYABLE_STATUSES.has(response.status)) {
      throw new Error(`Gemini API 요청이 실패했습니다 (status ${response.status})`);
    }

    if (attempt === maxAttempts) {
      throw new Error(`Gemini API 요청이 실패했습니다 (status ${response.status}, 재시도 ${attempt - 1}회)`);
    }

    await sleep(HTTP_RETRY_DELAYS_MS[attempt - 1]);
  }

  // 위 루프는 항상 return 또는 throw로 끝난다. 타입 체커를 위한 안전망.
  throw new Error("Gemini API 요청이 실패했습니다");
}

/**
 * Interactions API 응답에서 모델이 생성한 텍스트를 꺼낸다.
 * 문서에 명시된 응답 스키마가 일관되지 않아(outputText / output_text / steps[].content[].text
 * 등 예시가 혼재) 알려진 형태를 모두 시도한다.
 */
function extractOutputText(raw: unknown): string {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Gemini API 응답 형식을 해석할 수 없습니다");
  }

  const body = raw as Record<string, unknown>;

  if (typeof body.outputText === "string") {
    return body.outputText;
  }
  if (typeof body.output_text === "string") {
    return body.output_text;
  }

  if (Array.isArray(body.steps)) {
    for (let i = body.steps.length - 1; i >= 0; i--) {
      const step = body.steps[i];
      if (typeof step !== "object" || step === null) continue;

      const stepObj = step as Record<string, unknown>;
      if (stepObj.type !== "model_output") continue;

      const content = stepObj.content;
      if (!Array.isArray(content)) continue;

      const texts = content
        .filter((part): part is Record<string, unknown> => typeof part === "object" && part !== null)
        .filter((part) => part.type === "text" && typeof part.text === "string")
        .map((part) => part.text as string);

      if (texts.length > 0) {
        return texts.join("");
      }
    }
  }

  throw new Error("Gemini API 응답에서 결과 텍스트를 찾을 수 없습니다");
}

export async function generateJson(prompt: string, options?: GenerateJsonOptions): Promise<unknown> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const raw = await callInteractions(prompt, options);

    let text: string;
    try {
      text = extractOutputText(raw);
    } catch {
      lastError = new Error("Gemini API 응답 구조를 해석할 수 없습니다");
      continue;
    }

    try {
      return JSON.parse(text);
    } catch {
      lastError = new Error("Gemini API 응답을 JSON으로 해석할 수 없습니다");
      continue;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Gemini API 응답을 처리할 수 없습니다");
}

export interface ImageInput {
  mimeType: string;
  /** base64 (data: 접두어 없음) */
  data: string;
}

/**
 * 이미지(들)와 프롬프트를 보내 일반 텍스트를 돌려받는다. (OCR 등)
 * 이미지 데이터·프롬프트·응답 본문은 로그나 에러 메시지에 넣지 않는다.
 */
export async function generateTextFromImages(
  prompt: string,
  images: ImageInput[],
  options?: GenerateJsonOptions
): Promise<string> {
  const input: InteractionInputPart[] = [
    { type: "text", text: prompt },
    ...images.map((image) => ({
      type: "image" as const,
      data: image.data,
      mime_type: image.mimeType,
    })),
  ];

  const raw = await callInteractions(input, { ...options, plainText: true });
  return extractOutputText(raw);
}
