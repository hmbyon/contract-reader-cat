// 이 스크립트는 실제 Gemini API를 호출한다 (API 호출 2회: work-01.txt, rent-01.txt 각 1회).
//
// .ts 모듈을 불러오는 방식: node의 기본 TypeScript type-stripping을 쓰되, lib/classify.ts가
// 내부에서 "./pii", "./gemini"처럼 확장자 없이 import하기 때문에(tsc/Next 번들러 기준 정상 코드,
// tsconfig.json은 건드리지 않음) node의 ESM 로더가 그대로는 찾지 못한다. 그래서 새 의존성 없이
// node:module의 module.registerHooks()로 resolve 훅을 하나 걸어, 상대 경로 import가
// 확장자 없이 실패하면 ".ts"를 붙여 한 번 더 시도하도록 했다. 훅 등록 후 classify.ts는
// 정적 import가 아닌 동적 import()로 불러와야 훅이 그 내부 import 체인에도 적용된다.
import fs from "node:fs";
import path from "node:path";
import module from "node:module";

module.registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
      if (error?.code === "ERR_MODULE_NOT_FOUND" && isRelative && !specifier.endsWith(".ts")) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw error;
    }
  },
});

const { classifyContract } = await import("../lib/classify.ts");

const projectRoot = process.cwd();
const samplesDir = path.join(projectRoot, "data", "samples");

// next dev/build와 달리 plain node로 실행하므로 .env.local을 직접 읽어 process.env에 채운다.
// (파일을 수정하지 않고 읽기만 한다. 이미 설정된 환경변수는 덮어쓰지 않는다.)
function loadEnvLocal() {
  const envPath = path.join(projectRoot, ".env.local");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf-8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();

    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadEnvLocal();

let hasMismatch = false;

function reportMismatch(message) {
  console.log(`[MISMATCH] ${message}`);
  hasMismatch = true;
}

// 1) 실제 API 호출 2회: work-01.txt -> "work", rent-01.txt -> "rent" 기대
const cases = [
  { file: "work-01.txt", expected: "work" },
  { file: "rent-01.txt", expected: "rent" },
];

for (const { file, expected } of cases) {
  const content = fs.readFileSync(path.join(samplesDir, file), "utf-8");
  const result = await classifyContract(content);

  console.log(`${file}: type=${result.type}, confidence=${result.confidence}`);

  if (result.type !== expected) {
    reportMismatch(`${file}: 기대한 type은 "${expected}"인데 "${result.type}"입니다`);
  }
}

// 2) 개인정보가 감지되면 AI(fetch)를 호출하지 않는지 확인한다.
//    실제 API를 타지 않도록 fetch를 가짜로 바꿔서 호출 여부만 검증한다.
const originalFetch = globalThis.fetch;
let fetchCalled = false;

globalThis.fetch = async () => {
  fetchCalled = true;
  throw new Error("이 테스트에서는 fetch가 호출되면 안 됩니다");
};

try {
  await classifyContract("연락처: 010-1234-5678");
  reportMismatch("PII가 포함된 텍스트인데 classifyContract가 에러를 던지지 않았습니다");
} catch {
  // 기대된 동작: 에러를 던진다.
} finally {
  globalThis.fetch = originalFetch;
}

if (fetchCalled) {
  reportMismatch("PII가 감지되었는데 fetch(AI 호출)가 실행되었습니다");
} else {
  console.log("PII 감지 시 AI 미호출 확인: OK");
}

if (hasMismatch) {
  process.exit(1);
}
