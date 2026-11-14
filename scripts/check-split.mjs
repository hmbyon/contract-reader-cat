// .ts를 불러오는 방식: 새 의존성 없이, node가 기본으로 지원하는 TypeScript type-stripping으로
// 상대 경로에 확장자(.ts)를 명시해 그대로 import한다 (check-criteria.mjs / check-samples.mjs와 동일한 방식).
import fs from "node:fs";
import path from "node:path";
import { splitClauses } from "../lib/clauses.ts";
import { detectPII, maskPII } from "../lib/pii.ts";

const projectRoot = process.cwd();
const samplesDir = path.join(projectRoot, "data", "samples");
const answersPath = path.join(projectRoot, "data", "answers.json");

let hasMismatch = false;

function reportMismatch(message) {
  console.log(`[MISMATCH] ${message}`);
  hasMismatch = true;
}

// 1) data/samples/*.txt를 모두 splitClauses로 나누고, answers.json의 clause 목록이
//    결과의 no 목록에 모두 들어 있는지 확인한다.
const answers = JSON.parse(fs.readFileSync(answersPath, "utf-8"));
const sampleFiles = fs.readdirSync(samplesDir).filter((name) => name.endsWith(".txt"));

for (const fileName of sampleFiles) {
  const filePath = path.join(samplesDir, fileName);
  const content = fs.readFileSync(filePath, "utf-8");
  const clauses = splitClauses(content);
  const noList = clauses.map((clause) => clause.no);

  console.log(`${fileName}: ${noList.length}개 조항/문단 (${noList.join(", ")})`);

  const expectedClauses = answers[fileName];
  if (!expectedClauses) {
    continue;
  }

  for (const item of expectedClauses) {
    if (!noList.includes(item.clause)) {
      reportMismatch(`${fileName}: "${item.clause}"이 splitClauses 결과에 없습니다`);
    }
  }
}

// 2) 개인정보 패턴별로 detectPII가 각각 잡아내는지 확인한다.
const piiSamples = {
  주민번호: "901231-1234567",
  전화번호: "010-1234-5678",
  이메일: "test@example.com",
};

for (const [type, sample] of Object.entries(piiSamples)) {
  const detected = detectPII(sample);
  const found = detected.find((item) => item.type === type && item.count === 1);
  if (!found) {
    reportMismatch(`detectPII: "${sample}"에서 ${type}이 감지되지 않았습니다`);
  }
}

// 3) maskPII 결과에 원본 숫자가 남지 않는지 확인한다.
const combined = `연락처: ${piiSamples.전화번호}, 주민번호: ${piiSamples.주민번호}, 메일: ${piiSamples.이메일}`;
const masked = maskPII(combined);

for (const sample of Object.values(piiSamples)) {
  if (masked.includes(sample)) {
    reportMismatch(`maskPII: 마스킹 결과에 원본 문자열 "${sample}"이 남아 있습니다`);
  }
}

if (detectPII(masked).length > 0) {
  reportMismatch(`maskPII: 마스킹 결과에서 detectPII가 여전히 개인정보를 감지했습니다 (${masked})`);
}

console.log(`detectPII/maskPII 패턴 확인: ${combined} -> ${masked}`);

// 4) 개인정보가 없는 data/samples 파일들에서는 detectPII가 빈 배열을 반환하는지 확인한다.
for (const fileName of sampleFiles) {
  const filePath = path.join(samplesDir, fileName);
  const content = fs.readFileSync(filePath, "utf-8");
  const detected = detectPII(content);

  if (detected.length > 0) {
    reportMismatch(
      `detectPII: ${fileName}에 개인정보가 없어야 하는데 감지되었습니다 (${JSON.stringify(detected)})`
    );
  }
}

if (hasMismatch) {
  process.exit(1);
}
