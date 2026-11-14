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
const TIMEOUT_MS = 20_000;
const MAX_ATTEMPTS = 2; // 최초 1회 + JSON 파싱 실패 시 1회 재시도

// 일시적 오류로 보는 HTTP status. 이 값일 때만 1초, 2초 순서로 대기하며 최대 2회 재시도한다.
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const HTTP_RETRY_DELAYS_MS = [1000, 2000];

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

async function callInteractions(prompt: string): Promise<unknown> {
  const apiKey = getGeminiApiKey();
  const model = getModel();

  const maxAttempts = HTTP_RETRY_DELAYS_MS.length + 1; // 최초 1회 + 일시적 오류 재시도 최대 2회

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(INTERACTIONS_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          model,
          input: prompt,
          response_format: {
            type: "text",
            mime_type: "application/json",
          },
        }),
        signal: controller.signal,
      });
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

export async function generateJson(prompt: string): Promise<unknown> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const raw = await callInteractions(prompt);

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
