// 이 스크립트는 실제 Gemini API를 호출한다 (API 호출 4회: 파일 2개 × (유형 판별 1회 + 분석 1회)).
// 정답표(data/answers.json)와 비교해 탐지율·오탐 수·근거 일치율을 출력한다. 종료 코드는 항상 0.
//
// .ts 로딩 방식은 check-classify.mjs와 같다: module.registerHooks()로 확장자 없는 상대 import에
// ".ts"를 붙여 다시 시도하고, lib/analyze.ts는 훅 등록 후 동적 import()로 불러온다.
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

const { analyzeContract } = await import("../lib/analyze.ts");

const projectRoot = process.cwd();
const samplesDir = path.join(projectRoot, "data", "samples");

// plain node 실행이라 .env.local을 읽기만 해서 process.env에 채운다 (기존 값은 덮어쓰지 않음).
function loadEnvLocal() {
  const envPath = path.join(projectRoot, ".env.local");
  if (!fs.existsSync(envPath)) return;

  for (const line of fs.readFileSync(envPath, "utf-8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (key && !(key in process.env)) process.env[key] = value;
  }
}

loadEnvLocal();

const answers = JSON.parse(fs.readFileSync(path.join(projectRoot, "data", "answers.json"), "utf-8"));
const files = ["work-01.txt", "rent-01.txt"];

function unique(list) {
  return [...new Set(list)];
}

let totalRisk = 0;
let totalCaught = 0;
let totalFalse = 0;
let totalFindings = 0;
let totalQuoteOk = 0;

for (const file of files) {
  const text = fs.readFileSync(path.join(samplesDir, file), "utf-8");
  const expected = answers[file] ?? [];
  const riskClauses = unique(expected.filter((a) => a.expected === "risk").map((a) => a.clause));
  const cleanClauses = unique(expected.filter((a) => a.expected === "clean").map((a) => a.clause));

  let result;
  try {
    result = await analyzeContract(text);
  } catch (error) {
    // 본문·프롬프트·키가 섞이지 않도록 에러 이름만 출력한다.
    console.log(`${file}: 분석 실패 (${error?.name ?? "Error"})`);
    continue;
  }

  const found = new Set(result.findings.map((f) => f.clause_no));
  const missed = riskClauses.filter((c) => !found.has(c));
  const falsePositives = cleanClauses.filter((c) => found.has(c));
  const quoteOk = result.findings.filter((f) => f.quote !== "").length;

  const caught = riskClauses.length - missed.length;
  totalRisk += riskClauses.length;
  totalCaught += caught;
  totalFalse += falsePositives.length;
  totalFindings += result.findings.length;
  totalQuoteOk += quoteOk;

  console.log(`\n[${file}] type=${result.type} (confidence ${result.type_confidence})`);
  console.log(`  findings ${result.findings.length}개 (risk ${result.summary.risk}, check ${result.summary.check})`);
  console.log(`  탐지: ${caught}/${riskClauses.length}  놓친 조항: ${missed.join(", ") || "없음"}`);
  console.log(`  오탐: ${falsePositives.length}개  오탐 조항: ${falsePositives.join(", ") || "없음"}`);
  console.log(`  근거 일치: ${quoteOk}/${result.findings.length}`);
}

const pct = (a, b) => (b === 0 ? "n/a" : `${((a / b) * 100).toFixed(1)}%`);
console.log("\n=== 전체 ===");
console.log(`탐지율: ${totalCaught}/${totalRisk} (${pct(totalCaught, totalRisk)})`);
console.log(`오탐 수: ${totalFalse}`);
console.log(`근거 일치율: ${totalQuoteOk}/${totalFindings} (${pct(totalQuoteOk, totalFindings)})`);

process.exit(0);
