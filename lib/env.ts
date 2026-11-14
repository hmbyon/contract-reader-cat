/**
 * .env.local에서 읽는 서버 전용 환경 변수.
 * 값은 저장소에 커밋하지 않는다. (.env.example 참고)
 */
export function getGeminiApiKey(): string {
  const key = process.env.GEMINI_API_KEY;

  if (!key) {
    throw new Error("GEMINI_API_KEY is not set. Add it to .env.local");
  }

  return key;
}
