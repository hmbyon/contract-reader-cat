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

// 일시적 오류로 보는 HTTP status. 이 값일 때만 대기 후 최대 3회 재시도한다(총 4번 시도).
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const HTTP_RETRY_DELAYS_MS = [1500, 3000, 6000];
const RETRY_JITTER_MAX_MS = 500; // 대기 시간마다 0~500ms 무작위를 더한다.
const MAX_RETRY_AFTER_MS = 8000; // Retry-After 헤더 값의 상한

// 호출 한 번(재시도 포함)의 총 시간 예산. /api/analyze는 호출 2번(유형 판별 + 기준표 매칭)을
// 순서대로 하므로 28초 × 2가 maxDuration(60초) 안에 들어와야 한다.
const DEFAULT_JSON_BUDGET_MS = 28_000;
const DEFAULT_IMAGES_BUDGET_MS = 50_000;

export type InteractionInputPart =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mime_type: string };

export interface GenerateJsonOptions {
  thinkingLevel?: "low" | "medium" | "high";
  /** 시도 한 번의 타임아웃. 남은 시간 예산보다 길 수는 없다. */
  timeoutMs?: number;
  /** 호출 한 번(재시도 포함)의 총 시간 예산. 기본값은 호출 종류에 따라 다르다. */
  budgetMs?: number;
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

type CallKind = "json" | "images";

interface InteractionOptions extends GenerateJsonOptions {
  // true이면 JSON 응답 형식 지정 없이 일반 텍스트로 받는다.
  plainText?: boolean;
  kind: CallKind;
  /** 이 시각(epoch ms)까지 호출이 끝나야 한다. */
  deadline: number;
}

function retryDelayMs(retryIndex: number, response: Response): number {
  const header = response.headers.get("retry-after");
  if (header !== null) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
    }
  }
  return HTTP_RETRY_DELAYS_MS[retryIndex] + Math.random() * RETRY_JITTER_MAX_MS;
}

/** 오류 응답에서 error.status 문자열(예: UNAVAILABLE)만 꺼낸다. 본문 나머지는 읽고 버린다. */
async function readErrorStatus(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { error?: { status?: unknown } };
    const status = body?.error?.status;
    return typeof status === "string" && /^[A-Z_]{1,40}$/.test(status) ? status : undefined;
  } catch {
    return undefined;
  }
}

/** 실패한 시도마다 한 줄. 프롬프트·계약서·이미지·응답 본문·키는 남기지 않는다. */
function logAttempt(
  kind: CallKind,
  attempt: number,
  model: string,
  startedAt: number,
  status: number | "timeout" | "network",
  errorStatus?: string
) {
  console.error(
    `[gemini] kind=${kind} attempt=${attempt} status=${status}` +
      `${errorStatus ? ` errorStatus=${errorStatus}` : ""} model=${model} elapsedMs=${Date.now() - startedAt}`
  );
}

async function callInteractions(
  input: string | InteractionInputPart[],
  options: InteractionOptions
): Promise<unknown> {
  const apiKey = getGeminiApiKey();
  const model = getModel();
  const attemptTimeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const requestBody: Record<string, unknown> = {
    model,
    input,
  };

  if (!options.plainText) {
    requestBody.response_format = {
      type: "text",
      mime_type: "application/json",
    };
  }

  // thinking_level은 generation_config 안에 넣는다 (ai.google.dev Interactions API 문서 기준).
  if (options.thinkingLevel) {
    requestBody.generation_config = { thinking_level: options.thinkingLevel };
  }

  const maxAttempts = HTTP_RETRY_DELAYS_MS.length + 1; // 최초 1회 + 일시적 오류 재시도 최대 3회
  let timeoutRetried = false; // 타임아웃(AbortError)은 이 재시도 횟수와 별도로 1회만 재시도한다.
  let tryNo = 0; // 로그용 시도 번호(타임아웃 재시도 포함)

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // 각 시도의 타임아웃은 남은 시간 예산을 넘지 않는다.
    const remaining = options.deadline - Date.now();
    if (remaining <= 0) {
      throw new Error("Gemini API 응답 시간 초과 (시간 예산 소진)");
    }

    tryNo += 1;
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(attemptTimeoutMs, remaining));

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
        logAttempt(options.kind, tryNo, model, startedAt, "timeout");
        if (!timeoutRetried && options.deadline - Date.now() > 0) {
          timeoutRetried = true;
          attempt -= 1; // 상태코드 재시도 횟수를 소모하지 않고 한 번 더 시도한다.
          continue;
        }
        throw new Error("Gemini API 응답 시간 초과");
      }
      logAttempt(options.kind, tryNo, model, startedAt, "network");
      throw error;
    } finally {
      clearTimeout(timer);
    }

    if (response.ok) {
      return await response.json();
    }

    const errorStatus = await readErrorStatus(response);
    logAttempt(options.kind, tryNo, model, startedAt, response.status, errorStatus);

    if (!RETRYABLE_STATUSES.has(response.status)) {
      throw new Error(`Gemini API 요청이 실패했습니다 (status ${response.status})`);
    }

    if (attempt === maxAttempts) {
      throw new Error(`Gemini API 요청이 실패했습니다 (status ${response.status}, 재시도 ${attempt - 1}회)`);
    }

    const delay = retryDelayMs(attempt - 1, response);
    if (options.deadline - Date.now() <= delay) {
      // 남은 예산이 대기 시간보다 짧으면 더 기다리지 않고 바로 실패 처리한다.
      throw new Error(`Gemini API 요청이 실패했습니다 (status ${response.status}, 시간 예산 부족)`);
    }

    await sleep(delay);
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
  // 시간 예산은 JSON 파싱 재시도까지 합쳐서 적용한다.
  const deadline = Date.now() + (options?.budgetMs ?? DEFAULT_JSON_BUDGET_MS);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0 && deadline - Date.now() <= 0) break;
    const raw = await callInteractions(prompt, { ...options, kind: "json", deadline });

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

  const deadline = Date.now() + (options?.budgetMs ?? DEFAULT_IMAGES_BUDGET_MS);
  const raw = await callInteractions(input, { ...options, plainText: true, kind: "images", deadline });
  return extractOutputText(raw);
}
